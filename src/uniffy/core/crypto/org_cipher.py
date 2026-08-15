"""Per-organization envelope encryption.

Ciphertext is framed ``v{version}:{Fernet-token}`` so decrypts can pick the
right DEK after rotation. All DB writes ride the caller's session/transaction.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.cache import get_org_dek_lru
from uniffy.core.crypto.consumers import CRYPTO_CONSUMERS
from uniffy.core.crypto.errors import (
    CiphertextFormatError,
    CryptoError,
    OrgDekNotFoundError,
)
from uniffy.core.crypto.pubsub import publish_dek_invalidation
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.observability.metrics import (
    ORG_DEK_CACHE_HIT_TOTAL,
    ORG_DEK_CACHE_MISS_TOTAL,
    ORG_DEK_UNWRAP_SECONDS,
)

logger = logger.bind(component="crypto")


class SupportSessionCipherBridgeDenied(CryptoError):
    """Default-deny when a support-session actor decrypts without
    ``allow_support_session_bridge=True``.

    Upstream layers catch this and surface secrets as masked placeholders.
    """


_REENCRYPT_BATCH_SIZE = 200


class OrgCipher:
    """Envelope-encryption seam for per-org secrets."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def encrypt(self, organization_id: UUID, plaintext: str) -> str:
        fernet, version = await self._active_fernet(organization_id)
        token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"v{version}:{token}"

    async def decrypt(
        self,
        organization_id: UUID,
        ciphertext: str,
        *,
        allow_support_session_bridge: bool = False,
    ) -> str:
        """Decrypt previously-produced ciphertext.

        Under an active support session for ``organization_id`` the call refuses
        unless ``allow_support_session_bridge=True``. A bridge-attempt audit row
        is written either way so the org owner sees every exposure attempt.
        """
        from uniffy.domains.platform.support_session.context import (
            get_active_support_session,
        )

        active = get_active_support_session()
        if active is not None and active.organization_id == organization_id:
            await self._write_bridge_attempt_audit(
                active=active,
                organization_id=organization_id,
                allowed=allow_support_session_bridge,
            )
            if not allow_support_session_bridge:
                raise SupportSessionCipherBridgeDenied(
                    "Decryption refused under an active support session; "
                    "caller must opt in via allow_support_session_bridge=True"
                )

        version, payload = self._parse(ciphertext)
        fernet = await self._fernet_for(organization_id, version)
        try:
            return fernet.decrypt(payload.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise CryptoError(
                "Failed to decrypt ciphertext; wrong organization or corrupted payload"
            ) from exc

    async def _write_bridge_attempt_audit(
        self,
        *,
        active,
        organization_id: UUID,
        allowed: bool,
    ) -> None:
        """Write the bridge-attempt audit row on a dedicated session so it
        survives caller rollback.
        """
        from uniffy.core.audit import write_audit_event
        from uniffy.core.audit.actions import Action
        from uniffy.core.models.audit.event import AuditResourceType
        from uniffy.db import open_session

        try:
            async with open_session() as audit_session:
                await write_audit_event(
                    audit_session,
                    organization_id=organization_id,
                    actor_user_id=active.support_user_id,
                    action=Action.SUPPORT_SESSION_CIPHER_BRIDGE_ATTEMPT,
                    resource_type=AuditResourceType.SUPPORT_SESSION,
                    resource_id=active.session_id,
                    details={
                        "allowed": allowed,
                        "scope": active.scope,
                    },
                )
                await audit_session.commit()
        except Exception:
            logger.warning(
                "OrgCipher: failed to record bridge-attempt audit row",
                component="crypto",
            )

    async def provision(
        self,
        organization_id: UUID,
        created_by_user_id: UUID | None,
    ) -> OrgEncryptionKey:
        """Create the initial v1 DEK; race-safe against the partial unique index."""
        existing = await self._load_active(organization_id)
        if existing is not None:
            return existing

        wrapped = wrap_dek(generate_dek())
        row = OrgEncryptionKey(
            organization_id=organization_id,
            version=1,
            wrapped_dek=wrapped,
            is_active=True,
            created_by_user_id=created_by_user_id,
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._load_active(organization_id)
            if existing is None:
                raise
            return existing
        return row

    async def rotate(
        self,
        organization_id: UUID,
        rotated_by_user_id: UUID | None,
    ) -> int:
        """Insert a fresh active DEK, retire the previous one, sweep consumers.

        Drains any prior incomplete sweep against the current active DEK FIRST
        so the active DEK is the single source of truth before the swap. Then
        publishes cross-pod invalidation BEFORE the new sweep. Operators can
        run :meth:`resume_reencryption` directly to complete a half-rotated
        state without inserting another DEK.
        """
        previous = await self._load_active(organization_id)
        if previous is None:
            raise OrgDekNotFoundError(
                f"Cannot rotate: organization {organization_id} has no active DEK"
            )

        # Rows already on `previous` decrypt-and-re-encrypt under the same
        # key with no functional change; rows on a retired DEK migrate up.
        await self._re_encrypt_all_consumers(organization_id)

        await self._session.execute(
            update(OrgEncryptionKey)
            .where(OrgEncryptionKey.id == previous.id)
            .values(is_active=False, retired_at=datetime.now(UTC))
        )

        new_version = previous.version + 1
        new_row = OrgEncryptionKey(
            organization_id=organization_id,
            version=new_version,
            wrapped_dek=wrap_dek(generate_dek()),
            is_active=True,
            created_by_user_id=rotated_by_user_id,
        )
        self._session.add(new_row)
        await self._session.flush()
        await self._session.commit()

        await get_org_dek_lru().invalidate(organization_id)
        await publish_dek_invalidation(organization_id)

        await self._re_encrypt_all_consumers(organization_id)

        return new_version

    async def resume_reencryption(self, organization_id: UUID) -> None:
        """Idempotent recovery path for a :meth:`rotate` that crashed mid-sweep."""
        await self._re_encrypt_all_consumers(organization_id)

    async def _re_encrypt_all_consumers(self, organization_id: UUID) -> None:
        """Decrypt-with-old / encrypt-with-new for every consumer row; commits every batch."""
        for consumer in CRYPTO_CONSUMERS:
            batch = 0
            async for row in consumer.list_rows(self._session, organization_id):
                ciphertext = consumer.get_ciphertext(row)
                plaintext = await self.decrypt(
                    organization_id,
                    ciphertext,
                    allow_support_session_bridge=True,
                )
                fresh_ciphertext = await self.encrypt(organization_id, plaintext)
                consumer.set_ciphertext(row, fresh_ciphertext)
                batch += 1
                if batch >= _REENCRYPT_BATCH_SIZE:
                    await self._session.commit()
                    batch = 0
            if batch > 0:
                await self._session.commit()

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

    async def _load_active(
        self,
        organization_id: UUID,
    ) -> OrgEncryptionKey | None:
        result = await self._session.execute(
            select(OrgEncryptionKey).where(
                OrgEncryptionKey.organization_id == organization_id,
                OrgEncryptionKey.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _load_version(
        self,
        organization_id: UUID,
        version: int,
    ) -> OrgEncryptionKey | None:
        result = await self._session.execute(
            select(OrgEncryptionKey).where(
                OrgEncryptionKey.organization_id == organization_id,
                OrgEncryptionKey.version == version,
            )
        )
        return result.scalar_one_or_none()

    async def _active_fernet(
        self,
        organization_id: UUID,
    ) -> tuple[Fernet, int]:
        row = await self._load_active(organization_id)
        if row is None:
            raise OrgDekNotFoundError(f"Organization {organization_id} has no active DEK")
        fernet = await self._fernet_for(organization_id, row.version, row=row)
        return fernet, row.version

    async def _fernet_for(
        self,
        organization_id: UUID,
        version: int,
        *,
        row: OrgEncryptionKey | None = None,
    ) -> Fernet:
        lru = get_org_dek_lru()
        cached = await lru.get(organization_id, version)
        if cached is not None:
            ORG_DEK_CACHE_HIT_TOTAL.inc()
            return cached

        ORG_DEK_CACHE_MISS_TOTAL.inc()
        if row is None:
            row = await self._load_version(organization_id, version)
            if row is None:
                raise OrgDekNotFoundError(
                    f"Organization {organization_id} has no DEK version v{version}"
                )

        started = time.perf_counter()
        dek = unwrap_dek(row.wrapped_dek)
        ORG_DEK_UNWRAP_SECONDS.observe(time.perf_counter() - started)
        fernet = Fernet(dek)
        await lru.set(organization_id, version, fernet)
        return fernet
