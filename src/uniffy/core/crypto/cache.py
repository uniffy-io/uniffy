"""In-process LRU for per-org Data Encryption Keys.

Decryption is hot: every agent provider-key decrypt and every future
per-org secret read goes through ``OrgCipher``. Without a cache, each
read would unwrap the wrapped DEK with the master cipher on every
call. The LRU caches the constructed ``Fernet`` for each
``(org_id, version)`` pair so subsequent decrypts skip the master
unwrap entirely.

Cross-pod invalidation lands via the ``org_deks:invalidate:{org_id}``
pubsub channel (``core/crypto/pubsub.py``). A rotation in any pod
publishes once; every pod's subscriber drops the matching entries.

The LRU is in-process only -- DEK plaintext never enters Valkey.
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
