"""In-process caches for Data Encryption Keys.

Decryption is hot: every secret read goes through one of the cipher
seams (per-org or deployment-singleton). Without a cache each read
would unwrap the wrapped DEK with the master cipher on every call.
The caches keep the constructed ``Fernet`` per ``(scope, version)``
so subsequent decrypts skip the master unwrap.

Cross-pod invalidation lands via the
``org_deks:invalidate:{org_id}`` channel for the per-org LRU and
``deployment_deks:invalidate`` for the deployment-singleton cache
(``core/crypto/pubsub.py``). A rotation in any pod publishes once;
every pod's subscriber drops the matching entries.

Both caches are in-process only -- DEK plaintext never enters Valkey.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from cryptography.fernet import Fernet


_TTL_SECONDS = 3600
_MAX_SIZE = 1024


@dataclass
class _CachedDek:
    fernet: Fernet
    cached_at: float


class OrgDekLRU:
    """Bounded TTL + LRU keyed on ``(organization_id, version)``.

    Concurrency: a single ``asyncio.Lock`` serialises mutations.
    Contention is negligible (the loaded ``Fernet`` is the expensive
    part; LRU mutations are constant-time).
    """

    def __init__(self) -> None:
        self._entries: OrderedDict[tuple[UUID, int], _CachedDek] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, organization_id: UUID, version: int) -> Fernet | None:
        """Return the cached Fernet or ``None`` if absent / expired."""
        async with self._lock:
            entry = self._entries.get((organization_id, version))
            if entry is None:
                return None
            if time.time() - entry.cached_at > _TTL_SECONDS:
                self._entries.pop((organization_id, version), None)
                return None
            self._entries.move_to_end((organization_id, version))
            return entry.fernet

    async def set(
        self,
        organization_id: UUID,
        version: int,
        fernet: Fernet,
    ) -> None:
        """Cache the Fernet for ``(organization_id, version)``."""
        async with self._lock:
            key = (organization_id, version)
            self._entries[key] = _CachedDek(fernet=fernet, cached_at=time.time())
            self._entries.move_to_end(key)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate(self, organization_id: UUID) -> int:
        """Drop every cached version for the given organization.

        Returns the number of entries removed.
        """
        async with self._lock:
            to_drop = [
                key for key in self._entries if key[0] == organization_id
            ]
            for key in to_drop:
                self._entries.pop(key, None)
            return len(to_drop)

    async def clear(self) -> None:
        """Drop every entry. Test-only convenience."""
        async with self._lock:
            self._entries.clear()

    async def size(self) -> int:
        """Return the current entry count."""
        async with self._lock:
            return len(self._entries)


_lru: OrgDekLRU | None = None


def get_org_dek_lru() -> OrgDekLRU:
    """Return the process-singleton LRU, lazily initialised."""
    global _lru
    if _lru is None:
        _lru = OrgDekLRU()
    return _lru


class DeploymentDekCache:
    """Bounded TTL cache for the deployment-singleton DEK.

    Keyed only on ``version`` because the deployment cipher has no
    organization dimension. Old versions stay readable after rotation
    so historical ciphertexts decrypt; rotation publishes an
    invalidation message so every pod drops the soon-to-be-retired
    version before the re-encrypt sweep starts.
    """

    def __init__(self) -> None:
        self._entries: OrderedDict[int, _CachedDek] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, version: int) -> Fernet | None:
        async with self._lock:
            entry = self._entries.get(version)
            if entry is None:
                return None
            if time.time() - entry.cached_at > _TTL_SECONDS:
                self._entries.pop(version, None)
                return None
            self._entries.move_to_end(version)
            return entry.fernet

    async def set(self, version: int, fernet: Fernet) -> None:
        async with self._lock:
            self._entries[version] = _CachedDek(fernet=fernet, cached_at=time.time())
            self._entries.move_to_end(version)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate_all(self) -> int:
        """Drop every cached version. Returns the count removed."""
        async with self._lock:
            dropped = len(self._entries)
            self._entries.clear()
            return dropped

    async def invalidate_version(self, version: int) -> bool:
        """Drop one cached version. Returns True if a row was removed."""
        async with self._lock:
            return self._entries.pop(version, None) is not None

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_deployment_cache: DeploymentDekCache | None = None


def get_deployment_dek_cache() -> DeploymentDekCache:
    """Return the process-singleton deployment-DEK cache."""
    global _deployment_cache
    if _deployment_cache is None:
        _deployment_cache = DeploymentDekCache()
    return _deployment_cache
