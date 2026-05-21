"""Per-organization envelope encryption.

``OrgCipher`` is the public seam every consumer touches. It owns:

- Loading the active DEK row for an organization.
- Unwrapping the DEK with the master cipher (cached in the in-process
  ``OrgDekLRU`` so the master unwrap runs once per pod per hour per
  DEK).
- Encrypting / decrypting payloads under the per-org Fernet, framing
  the ciphertext as ``v{version}:{Fernet-token}`` so future decrypts
  know which DEK to use.
- Provisioning a v1 DEK at organization creation.
- Rotating to a fresh DEK on demand.

The class takes an ``AsyncSession`` so all DB writes share the caller's
transaction boundary.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
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

_REENCRYPT_BATCH_SIZE = 200


class OrgCipher:
    """Envelope-encryption seam for per-org secrets."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def encrypt(self, organization_id: UUID, plaintext: str) -> str:
        """Encrypt ``plaintext`` under the active DEK for the organization.

        The returned ciphertext is framed ``v{version}:{Fernet-token}``
        so subsequent decrypts can pick the right DEK even after rotation.
        """
        fernet, version = await self._active_fernet(organization_id)
        token = fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"v{version}:{token}"

    async def decrypt(self, organization_id: UUID, ciphertext: str) -> str:
        """Decrypt ``ciphertext`` previously produced by ``encrypt``.

        Cross-tenant ciphertexts fail loudly: the Fernet token only
        decrypts under the DEK that produced it, and that DEK belongs
        to exactly one organization.
        """
        version, payload = self._parse(ciphertext)
        fernet = await self._fernet_for(organization_id, version)
        try:
            return fernet.decrypt(payload.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise CryptoError(
                "Failed to decrypt ciphertext; wrong organization or corrupted payload"
            ) from exc

    async def provision(
        self,
        organization_id: UUID,
        created_by_user_id: UUID | None,
    ) -> OrgEncryptionKey:
        """Create the initial v1 DEK for an organization.

        Idempotent against the partial unique index: a concurrent caller
        that loses the race gets the existing row back instead of an
        error.
        """
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
        """Insert a fresh active DEK; retire the previous one; sweep consumers.

        Publishes the cross-pod invalidation BEFORE the re-encryption
        sweep so every pod stops caching the about-to-be-retired DEK.
        After publish, walks every registered ``ReEncryptingConsumer``
        and re-encrypts each row under the new DEK. Returns the new
        active version.
        """
        previous = await self._load_active(organization_id)
        if previous is None:
            raise OrgDekNotFoundError(
                f"Cannot rotate: organization {organization_id} has no active DEK"
            )

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

    async def _re_encrypt_all_consumers(self, organization_id: UUID) -> None:
        """Walk every ``ReEncryptingConsumer`` and re-encrypt each row.

        Each row is decrypted with the version it was written under
        (still readable -- the retired row stays in the DB) and
        re-encrypted under the new active DEK. Rows are committed in
        batches of ``_REENCRYPT_BATCH_SIZE`` so a long sweep doesn't
        balloon the transaction log.
        """
        for consumer in CRYPTO_CONSUMERS:
            batch = 0
            async for row in consumer.list_rows(self._session, organization_id):
                ciphertext = consumer.get_ciphertext(row)
                plaintext = await self.decrypt(organization_id, ciphertext)
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
            raise CiphertextFormatError(
                f"Non-numeric version segment: {version_str!r}"
            ) from exc
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
            raise OrgDekNotFoundError(
                f"Organization {organization_id} has no active DEK"
            )
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
