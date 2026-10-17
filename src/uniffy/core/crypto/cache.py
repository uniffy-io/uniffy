"""In-process caches for Data Encryption Keys.

Caches the constructed ``Fernet`` and the realtime buffer keys per ``(scope, version)`` so reads
skip the master unwrap. Cross-pod invalidation rides Valkey pubsub (``core/crypto/pubsub.py``).
DEK plaintext never enters Valkey.
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

    from uniffy.core.crypto.org_data_cipher import OrgDataKeys


_TTL_SECONDS = 3600
_MAX_SIZE = 1024
# Retired versions stay readable, so only the version that seals goes stale on rotation; this
# bound applies a rotation whose invalidation message never arrived.
_ACTIVE_VERSION_TTL_SECONDS = 60


@dataclass
class _Cached[T]:
    value: T
    cached_at: float


class OrgDekLRU[T]:
    """Bounded TTL + LRU of DEK material keyed on ``(organization_id, version)``."""

    def __init__(self) -> None:
        self._entries: OrderedDict[tuple[UUID, int], _Cached[T]] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, organization_id: UUID, version: int) -> T | None:
        async with self._lock:
            entry = self._entries.get((organization_id, version))
            if entry is None:
                return None
            if time.time() - entry.cached_at > _TTL_SECONDS:
                self._entries.pop((organization_id, version), None)
                return None
            self._entries.move_to_end((organization_id, version))
            return entry.value

    async def set(
        self,
        organization_id: UUID,
        version: int,
        value: T,
    ) -> None:
        async with self._lock:
            key = (organization_id, version)
            self._entries[key] = _Cached(value=value, cached_at=time.time())
            self._entries.move_to_end(key)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate(self, organization_id: UUID) -> int:
        """Drop every cached version for the org; returns the count removed."""
        async with self._lock:
            to_drop = [key for key in self._entries if key[0] == organization_id]
            for key in to_drop:
                self._entries.pop(key, None)
            return len(to_drop)

    async def clear(self) -> None:
        """Test-only: drop every entry."""
        async with self._lock:
            self._entries.clear()

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_lru: OrgDekLRU[Fernet] | None = None


def get_org_dek_lru() -> OrgDekLRU[Fernet]:
    global _lru
    if _lru is None:
        _lru = OrgDekLRU()
    return _lru


_data_key_lru: OrgDekLRU[OrgDataKeys] | None = None


def get_org_data_key_lru() -> OrgDekLRU[OrgDataKeys]:
    global _data_key_lru
    if _data_key_lru is None:
        _data_key_lru = OrgDekLRU()
    return _data_key_lru


class OrgActiveDekVersions:
    """Bounded TTL + LRU of the active DEK version per organization."""

    def __init__(self) -> None:
        self._entries: OrderedDict[UUID, _Cached[int]] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, organization_id: UUID) -> int | None:
        async with self._lock:
            entry = self._entries.get(organization_id)
            if entry is None:
                return None
            if time.time() - entry.cached_at > _ACTIVE_VERSION_TTL_SECONDS:
                self._entries.pop(organization_id, None)
                return None
            self._entries.move_to_end(organization_id)
            return entry.value

    async def set(self, organization_id: UUID, version: int) -> None:
        async with self._lock:
            self._entries[organization_id] = _Cached(value=version, cached_at=time.time())
            self._entries.move_to_end(organization_id)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate(self, organization_id: UUID) -> int:
        async with self._lock:
            return 0 if self._entries.pop(organization_id, None) is None else 1

    async def clear(self) -> None:
        """Test-only: drop every entry."""
        async with self._lock:
            self._entries.clear()

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_active_versions: OrgActiveDekVersions | None = None


def get_org_active_dek_versions() -> OrgActiveDekVersions:
    global _active_versions
    if _active_versions is None:
        _active_versions = OrgActiveDekVersions()
    return _active_versions


async def invalidate_org_dek_caches(organization_id: UUID) -> int:
    """Drop every key and active version this process caches for one organization."""
    return (
        await get_org_dek_lru().invalidate(organization_id)
        + await get_org_data_key_lru().invalidate(organization_id)
        + await get_org_active_dek_versions().invalidate(organization_id)
    )


class DeploymentDekCache:
    """Bounded TTL cache for the deployment-singleton DEK; keyed only on version.

    Old versions stay readable so historical ciphertexts decrypt; rotation
    publishes an invalidation so every pod drops the retiring version before
    the re-encrypt sweep starts.
    """

    def __init__(self) -> None:
        self._entries: OrderedDict[int, _Cached[Fernet]] = OrderedDict()
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
            return entry.value

    async def set(self, version: int, fernet: Fernet) -> None:
        async with self._lock:
            self._entries[version] = _Cached(value=fernet, cached_at=time.time())
            self._entries.move_to_end(version)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate_all(self) -> int:
        async with self._lock:
            dropped = len(self._entries)
            self._entries.clear()
            return dropped

    async def invalidate_version(self, version: int) -> bool:
        async with self._lock:
            return self._entries.pop(version, None) is not None

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_deployment_cache: DeploymentDekCache | None = None


def get_deployment_dek_cache() -> DeploymentDekCache:
    global _deployment_cache
    if _deployment_cache is None:
        _deployment_cache = DeploymentDekCache()
    return _deployment_cache
