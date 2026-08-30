"""Deployment-scope envelope encryption (singleton counterpart to ``OrgCipher``).

Self-provisions a v1 row on first use. Rotation bumps the version, publishes
a cross-pod invalidation, then re-encrypts every registered consumer under
the new DEK. Retired versions stay readable until the sweep finishes.

Ciphertext is framed ``v{version}:{Fernet-token}`` to match ``OrgCipher``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.cache import get_deployment_dek_cache
from uniffy.core.crypto.consumers import DEPLOYMENT_CRYPTO_CONSUMERS
from uniffy.core.crypto.errors import CiphertextFormatError, CryptoError
from uniffy.core.crypto.metrics import (
    DEPLOYMENT_DEK_CACHE_HIT_TOTAL,
    DEPLOYMENT_DEK_CACHE_MISS_TOTAL,
    DEPLOYMENT_DEK_UNWRAP_SECONDS,
)
from uniffy.core.crypto.pubsub import publish_deployment_dek_invalidation
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek
from uniffy.core.models.crypto.deployment_encryption_key import DeploymentEncryptionKey

_REENCRYPT_BATCH_SIZE = 200


class DeploymentCipher:
    """Envelope-encryption seam for deployment-scope secrets."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def encrypt(self, plaintext: str) -> str:
        """Encrypt under the active deployment DEK; provisions v1 if missing."""
        fernet, version = await self._active_fernet()
        token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"v{version}:{token}"

    async def decrypt(self, ciphertext: str) -> str:
        version, payload = self._parse(ciphertext)
        fernet = await self._fernet_for(version)
        try:
            return fernet.decrypt(payload.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise CryptoError(
                "Failed to decrypt deployment ciphertext; master key mismatch or payload corrupted"
            ) from exc

    async def get_active_version(self) -> int | None:
        """Active DEK version, or ``None`` when none has been provisioned."""
        row = await self._load_active()
        return row.version if row is not None else None

    async def provision_if_missing(self) -> int:
        """Idempotent provision call invoked from the app lifespan; returns active version."""
        existing = await self._load_active()
        if existing is not None:
            return existing.version
        row = await self._provision_v1()
        return row.version

    async def get_status(self) -> DeploymentEncryptionStatus:
        rows = (
            (
                await self._session.execute(
                    select(DeploymentEncryptionKey).order_by(DeploymentEncryptionKey.version.desc())
                )
            )
            .scalars()
            .all()
        )
        active = next((r for r in rows if r.is_active), None)
        return DeploymentEncryptionStatus(
            active_version=active.version if active else None,
            active_created_at=active.created_at if active else None,
            total_versions=len(rows),
        )

    async def rotate(self) -> int:
        """Insert a fresh DEK, retire the previous one, sweep consumers.

        Invalidation is published BEFORE the sweep so every pod drops the
        retiring Fernet; subsequent reads reload it from the row until the
        sweep finishes re-encrypting under the new DEK.
        """
        previous = await self._load_active()
        if previous is None:
            raise CryptoError("Cannot rotate deployment DEK: no active row exists yet")

        await self._session.execute(
            update(DeploymentEncryptionKey)
            .where(DeploymentEncryptionKey.id == previous.id)
            .values(is_active=False, retired_at=datetime.now(UTC))
        )

        new_version = previous.version + 1
        new_row = DeploymentEncryptionKey(
            version=new_version,
            wrapped_dek=wrap_dek(generate_dek()),
            is_active=True,
        )
        self._session.add(new_row)
        await self._session.flush()
        await self._session.commit()

        await get_deployment_dek_cache().invalidate_all()
        await publish_deployment_dek_invalidation()

        await self._re_encrypt_all_consumers()

        return new_version

    async def _re_encrypt_all_consumers(self) -> None:
        """Decrypt-with-old / encrypt-with-new for every consumer row; commits every batch."""
        for consumer in DEPLOYMENT_CRYPTO_CONSUMERS:
            batch = 0
            async for row in consumer.list_rows(self._session):
                ciphertext = consumer.get_ciphertext(row)
                plaintext = await self.decrypt(ciphertext)
                fresh = await self.encrypt(plaintext)
                consumer.set_ciphertext(row, fresh)
                batch += 1
                if batch >= _REENCRYPT_BATCH_SIZE:
                    await self._session.commit()
                    batch = 0
            if batch > 0:
                await self._session.commit()

    async def _active_fernet(self) -> tuple[Fernet, int]:
        row = await self._load_active()
        if row is None:
            row = await self._provision_v1()
        fernet = await self._fernet_for(row.version, row=row)
        return fernet, row.version

    async def _fernet_for(
        self,
        version: int,
        *,
        row: DeploymentEncryptionKey | None = None,
    ) -> Fernet:
        cache = get_deployment_dek_cache()
        cached = await cache.get(version)
        if cached is not None:
            DEPLOYMENT_DEK_CACHE_HIT_TOTAL.inc()
            return cached

        DEPLOYMENT_DEK_CACHE_MISS_TOTAL.inc()
        if row is None:
            row = await self._load_version(version)
            if row is None:
                raise CryptoError(f"Deployment cipher has no DEK version v{version}")

        started = time.perf_counter()
        dek = unwrap_dek(row.wrapped_dek)
        DEPLOYMENT_DEK_UNWRAP_SECONDS.observe(time.perf_counter() - started)
        fernet = Fernet(dek)
        await cache.set(version, fernet)
        return fernet

    async def _load_active(self) -> DeploymentEncryptionKey | None:
        result = await self._session.execute(
            select(DeploymentEncryptionKey).where(
                DeploymentEncryptionKey.is_active == True  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _load_version(self, version: int) -> DeploymentEncryptionKey | None:
        result = await self._session.execute(
            select(DeploymentEncryptionKey).where(DeploymentEncryptionKey.version == version)
        )
        return result.scalar_one_or_none()

    async def _provision_v1(self) -> DeploymentEncryptionKey:
        row = DeploymentEncryptionKey(
            version=1,
            wrapped_dek=wrap_dek(generate_dek()),
            is_active=True,
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._load_active()
            if existing is None:
                raise
            return existing
        await self._session.commit()
        return row

    @staticmethod
    def _parse(ciphertext: str) -> tuple[int, str]:
        if not ciphertext or not ciphertext.startswith("v"):
            raise CiphertextFormatError(
                f"Missing version prefix in ciphertext: {ciphertext[:8]!r}..."
            )
        version_str, _, payload = ciphertext[1:].partition(":")
        if not payload:
            raise CiphertextFormatError("Missing payload after version prefix")
        try:
            version = int(version_str)
        except ValueError as exc:
            raise CiphertextFormatError(f"Non-numeric version segment: {version_str!r}") from exc
        return version, payload


@dataclass(frozen=True)
class DeploymentEncryptionStatus:
    """Deployment DEK snapshot for the admin UI."""

    active_version: int | None
    active_created_at: datetime | None
    total_versions: int


async def reset_deployment_cipher_cache() -> None:
    """Test-only: drop in-process cached DEKs."""
    await get_deployment_dek_cache().invalidate_all()
