"""Binary AEAD under per-organization DEKs for server-side bytes that must not rest in plaintext."""

from __future__ import annotations

import asyncio
import base64
import binascii
import os
import struct
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import ColumnElement, select

from uniffy.core.crypto.cache import get_org_active_dek_versions, get_org_data_key_lru
from uniffy.core.crypto.errors import CryptoError, OrgDekNotFoundError, SealedDataError
from uniffy.core.crypto.wrapping import unwrap_dek
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.infrastructure.database.session import open_session

_FORMAT = 0x01
# Format byte, then the DEK version as a 4-byte big-endian unsigned integer.
_HEADER = struct.Struct(">BI")
_NONCE_BYTES = 12
_TAG_BYTES = 16
SEAL_OVERHEAD_BYTES = _HEADER.size + _NONCE_BYTES + _TAG_BYTES
_KEY_BYTES = 32
# ``org_encryption_keys.version`` is a PostgreSQL integer and starts at 1. A header version outside
# that range is corrupt, and querying it would fail in the database instead of refusing to open.
_MAX_VERSION = 2**31 - 1
# Distinct HKDF labels keep the sealing and receipt keys independent of each other and of the
# Fernet keys ``OrgCipher`` builds from the same DEK.
_SEAL_INFO = b"uniffy-realtime-buffer-v1"
_RECEIPT_INFO = b"uniffy-realtime-receipt-v1"


class OrgKeySource(Protocol):
    """Raw 32-byte organization DEKs, held only in process memory."""

    async def active(self, organization_id: UUID) -> tuple[int, bytes]:
        """The active version and its key; raises ``OrgDekNotFoundError`` without one."""
        ...

    async def version(self, organization_id: UUID, version: int) -> bytes | None:
        """The key of one version, or ``None`` when the organization never had it."""
        ...


def _raw_dek(wrapped: str) -> bytes:
    try:
        raw = base64.urlsafe_b64decode(unwrap_dek(wrapped))
    except binascii.Error:
        raise CryptoError("Unwrapped DEK is not url-safe base64") from None
    if len(raw) != _KEY_BYTES:
        raise CryptoError("Unwrapped DEK does not hold 32 bytes")
    return raw


class DatabaseKeySource:
    """Reads ``org_encryption_keys`` on a short session of its own, since callers may hold none."""

    async def active(self, organization_id: UUID) -> tuple[int, bytes]:
        row = await self._load(
            OrgEncryptionKey.organization_id == organization_id,
            OrgEncryptionKey.is_active == True,  # noqa: E712
        )
        if row is None:
            raise OrgDekNotFoundError(f"Organization {organization_id} has no active DEK")
        version, wrapped = row
        return version, _raw_dek(wrapped)

    async def version(self, organization_id: UUID, version: int) -> bytes | None:
        row = await self._load(
            OrgEncryptionKey.organization_id == organization_id,
            OrgEncryptionKey.version == version,
        )
        return None if row is None else _raw_dek(row[1])

    @staticmethod
    async def _load(*conditions: ColumnElement[bool]) -> tuple[int, str] | None:
        async with open_session() as db:
            row = (
                await db.execute(
                    select(OrgEncryptionKey.version, OrgEncryptionKey.wrapped_dek).where(*conditions)
                )
            ).one_or_none()
        return None if row is None else (row.version, row.wrapped_dek)


class StaticKeySource:
    """Fixed keys, one active version per organization, for callers without a database.

    Derived keys share the process caches, so an organization id names one key per process.
    """

    def __init__(self, keys: Mapping[UUID, tuple[int, bytes]]) -> None:
        if any(len(raw) != _KEY_BYTES for _, raw in keys.values()):
            raise ValueError("static organization keys hold 32 bytes")
        self._keys = dict(keys)

    async def active(self, organization_id: UUID) -> tuple[int, bytes]:
        found = self._keys.get(organization_id)
        if found is None:
            raise OrgDekNotFoundError(f"Organization {organization_id} has no active DEK")
        return found

    async def version(self, organization_id: UUID, version: int) -> bytes | None:
        found = self._keys.get(organization_id)
        return found[1] if found is not None and found[0] == version else None


@dataclass(frozen=True, slots=True, repr=False)
class OrgDataKeys:
    """Keys derived from one DEK version; ``repr=False`` keeps key bytes out of logs."""

    version: int
    aead: AESGCM
    mac_key: bytes


@dataclass(slots=True)
class _Load:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    holders: int = 0


# ``None`` names the active version.
type _LoadKey = tuple[UUID, int | None]


def _derive(raw: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=_KEY_BYTES, salt=None, info=info).derive(raw)


class OrgDataCipher:
    """AES-256-GCM sealing of bytes the server keeps for itself, under the organization's DEK.

    It has no support-session bridge, unlike ``OrgCipher``: sealed bytes never leave the server
    as such, and content exposure is gated by ``PermissionChecker`` and ``SupportSession`` where
    content is served.
    """

    def __init__(self, key_source: OrgKeySource | None = None) -> None:
        self._source = key_source or DatabaseKeySource()
        self._loads: tuple[asyncio.AbstractEventLoop, dict[_LoadKey, _Load]] | None = None

    async def seal(self, organization_id: UUID, plaintext: bytes, *, aad: bytes) -> bytes:
        keys = await self._active(organization_id)
        header = _HEADER.pack(_FORMAT, keys.version)
        nonce = os.urandom(_NONCE_BYTES)
        # The header joins the associated data, so a rewritten version or format byte fails too.
        return header + nonce + keys.aead.encrypt(nonce, plaintext, header + aad)

    async def unseal(self, organization_id: UUID, sealed: bytes, *, aad: bytes) -> bytes:
        if len(sealed) < SEAL_OVERHEAD_BYTES:
            raise SealedDataError("Sealed bytes are truncated")
        sealed_format, version = _HEADER.unpack_from(sealed)
        if sealed_format != _FORMAT:
            raise SealedDataError(f"Unknown sealed format {sealed_format}")
        if not 0 < version <= _MAX_VERSION:
            raise SealedDataError(f"Unknown DEK version v{version}")
        keys = await self._version(organization_id, version)
        if keys is None:
            raise SealedDataError(f"Organization {organization_id} has no DEK version v{version}")
        body = _HEADER.size + _NONCE_BYTES
        try:
            return keys.aead.decrypt(
                sealed[_HEADER.size : body], sealed[body:], sealed[: _HEADER.size] + aad
            )
        except InvalidTag:
            raise SealedDataError("Sealed bytes fail authentication") from None

    async def receipt_digest(self, organization_id: UUID, data: bytes) -> str:
        """HMAC-SHA256 hex of ``data``; a keyed digest stores no plaintext fingerprint."""
        keys = await self._active(organization_id)
        mac = hmac.HMAC(keys.mac_key, hashes.SHA256())
        mac.update(data)
        return mac.finalize().hex()

    async def _active(self, organization_id: UUID) -> OrgDataKeys:
        cached = await self._cached_active(organization_id)
        if cached is not None:
            return cached
        async with self._one_load(organization_id, None):
            cached = await self._cached_active(organization_id)
            if cached is not None:
                return cached
            version, raw = await self._source.active(organization_id)
            keys = await self._remember(organization_id, version, raw)
            await get_org_active_dek_versions().set(organization_id, version)
            return keys

    async def _version(self, organization_id: UUID, version: int) -> OrgDataKeys | None:
        cached = await get_org_data_key_lru().get(organization_id, version)
        if cached is not None:
            return cached
        async with self._one_load(organization_id, version):
            cached = await get_org_data_key_lru().get(organization_id, version)
            if cached is not None:
                return cached
            raw = await self._source.version(organization_id, version)
            return None if raw is None else await self._remember(organization_id, version, raw)

    @staticmethod
    async def _cached_active(organization_id: UUID) -> OrgDataKeys | None:
        version = await get_org_active_dek_versions().get(organization_id)
        if version is None:
            return None
        return await get_org_data_key_lru().get(organization_id, version)

    @asynccontextmanager
    async def _one_load(self, organization_id: UUID, version: int | None) -> AsyncIterator[None]:
        """Concurrent misses for one key wait for a single load.

        Callers hold a document lock and a database connection while a load opens another
        session, so a miss after a TTL or rotation must not ask the pool for one per caller.
        """
        # A lock binds to the loop it first waits on, and a restarted worker runs a fresh loop.
        loop = asyncio.get_running_loop()
        if self._loads is None or self._loads[0] is not loop:
            self._loads = (loop, {})
        loads = self._loads[1]
        key = (organization_id, version)
        load = loads.setdefault(key, _Load())
        load.holders += 1
        try:
            async with load.lock:
                yield
        finally:
            load.holders -= 1
            if load.holders == 0:
                loads.pop(key, None)

    @staticmethod
    async def _remember(organization_id: UUID, version: int, raw: bytes) -> OrgDataKeys:
        keys = OrgDataKeys(version, AESGCM(_derive(raw, _SEAL_INFO)), _derive(raw, _RECEIPT_INFO))
        await get_org_data_key_lru().set(organization_id, version, keys)
        return keys
