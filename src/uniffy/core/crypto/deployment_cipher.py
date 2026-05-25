"""Deployment-scope envelope encryption.

:class:`DeploymentCipher` is the singleton counterpart to
:class:`OrgCipher`. It owns one Fernet keyed off a DEK that is wrapped
by the master KEK and stored in ``deployment_encryption_keys``.
Exactly one row is ``is_active=true`` at any given time; rotation
inserts a fresh version-bumped row, retires the previous one,
publishes a cross-pod invalidation, and re-encrypts every registered
:class:`DeploymentReEncryptingConsumer` under the new DEK.

The cipher self-provisions the v1 row on the first encrypt call so a
fresh deployment doesn't need a bootstrap step. After that, every
call shares the ``Fernet`` cached in :class:`DeploymentDekCache` --
unwrap runs once per pod per (version, TTL) bucket. Retired versions
stay readable so historical ciphertext keeps decrypting until the
rotation sweep finishes re-encrypting it.

Ciphertext is framed ``v{version}:{Fernet-token}`` to match
``OrgCipher`` so the wire shape is identical between the two seams.
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
from uniffy.core.crypto.pubsub import publish_deployment_dek_invalidation
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek
from uniffy.core.models.crypto.deployment_encryption_key import DeploymentEncryptionKey
from uniffy.observability.metrics import (
    DEPLOYMENT_DEK_CACHE_HIT_TOTAL,
    DEPLOYMENT_DEK_CACHE_MISS_TOTAL,
    DEPLOYMENT_DEK_UNWRAP_SECONDS,
)

_REENCRYPT_BATCH_SIZE = 200


class DeploymentCipher:
    """Envelope-encryption seam for deployment-scope secrets."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def encrypt(self, plaintext: str) -> str:
        """Encrypt ``plaintext`` under the active deployment DEK.

        Provisions the v1 DEK if the table is empty. Returns ciphertext
        framed ``v{version}:{Fernet-token}``.
        """
        fernet, version = await self._active_fernet()
        token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"v{version}:{token}"

    async def decrypt(self, ciphertext: str) -> str:
        """Decrypt ``ciphertext`` previously produced by ``encrypt``."""
        version, payload = self._parse(ciphertext)
        fernet = await self._fernet_for(version)
        try:
            return fernet.decrypt(payload.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise CryptoError(
                "Failed to decrypt deployment ciphertext; master key mismatch or payload corrupted"
            ) from exc

    async def get_active_version(self) -> int | None:
        """Return the active DEK version, or ``None`` if none provisioned."""
        row = await self._load_active()
        return row.version if row is not None else None

    async def provision_if_missing(self) -> int:
        """Ensure a v1 DEK exists. Returns the active version.

        Idempotent: a deployment that already has an active DEK gets
        its version back without writing. Called from the app lifespan
        on boot so ``/platform/encryption`` is never in the
        "Not provisioned" state once the backend is up.
        """
        existing = await self._load_active()
        if existing is not None:
            return existing.version
        row = await self._provision_v1()
        return row.version

    async def get_status(self) -> DeploymentEncryptionStatus:
        """Snapshot the active + retired DEK rows for the admin UI."""
        rows = (
            await self._session.execute(
                select(DeploymentEncryptionKey).order_by(
                    DeploymentEncryptionKey.version.desc()
                )
            )
        ).scalars().all()
        active = next((r for r in rows if r.is_active), None)
        return DeploymentEncryptionStatus(
            active_version=active.version if active else None,
            active_created_at=active.created_at if active else None,
            total_versions=len(rows),
        )

    async def rotate(self) -> int:
        """Insert a fresh DEK, retire the previous one, sweep consumers.

        Publishes the cross-pod invalidation BEFORE the re-encryption
        sweep so every pod drops the retiring fernet (subsequent reads
        reload it from the DB until the sweep finishes; the row stays
        in the table). After publish, walks every registered
        :class:`DeploymentReEncryptingConsumer` and re-encrypts each
        row under the new DEK. Returns the new active version.
        """
        previous = await self._load_active()
        if previous is None:
            raise CryptoError(
                "Cannot rotate deployment DEK: no active row exists yet"
            )

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
        """Walk every registered consumer and re-encrypt each row.

        Each row is decrypted with the version it was written under
        (the retired row stays in the DB so it is still readable) and
        re-encrypted under the new active DEK. Rows are committed in
        batches of ``_REENCRYPT_BATCH_SIZE`` so a long sweep doesn't
        balloon the transaction log.
        """
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
                raise CryptoError(
                    f"Deployment cipher has no DEK version v{version}"
                )

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
            select(DeploymentEncryptionKey).where(
                DeploymentEncryptionKey.version == version
            )
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
            raise CiphertextFormatError(
                f"Non-numeric version segment: {version_str!r}"
            ) from exc
        return version, payload


@dataclass(frozen=True)
class DeploymentEncryptionStatus:
    """Snapshot of deployment DEK state surfaced to the admin UI."""

    active_version: int | None
    active_created_at: datetime | None
    total_versions: int


async def reset_deployment_cipher_cache() -> None:
    """Drop in-process cached DEKs. Test-only."""
    await get_deployment_dek_cache().invalidate_all()
