"""DeploymentDekCache TTL + invalidation."""

from __future__ import annotations

import asyncio

import pytest
from cryptography.fernet import Fernet

from uniffy.core.crypto import cache as cache_module
from uniffy.core.crypto.cache import DeploymentDekCache


def _make_fernet() -> Fernet:
    return Fernet(Fernet.generate_key())


def test_get_returns_none_when_missing() -> None:
    async def run() -> None:
        cache = DeploymentDekCache()
        assert await cache.get(1) is None

    asyncio.run(run())


def test_set_get_round_trip() -> None:
    async def run() -> None:
        cache = DeploymentDekCache()
        f = _make_fernet()
        await cache.set(1, f)
        assert await cache.get(1) is f

    asyncio.run(run())


def test_get_drops_expired_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        cache = DeploymentDekCache()
        await cache.set(1, _make_fernet())
        monkeypatch.setattr(cache_module, "_TTL_SECONDS", -1)
        assert await cache.get(1) is None
        assert await cache.size() == 0

    asyncio.run(run())


def test_invalidate_all_drops_every_version() -> None:
    async def run() -> None:
        cache = DeploymentDekCache()
        await cache.set(1, _make_fernet())
        await cache.set(2, _make_fernet())
        dropped = await cache.invalidate_all()
        assert dropped == 2
        assert await cache.size() == 0

    asyncio.run(run())


def test_invalidate_version_drops_only_one_version() -> None:
    async def run() -> None:
        cache = DeploymentDekCache()
        await cache.set(1, _make_fernet())
        await cache.set(2, _make_fernet())
        assert await cache.invalidate_version(1) is True
        assert await cache.get(1) is None
        assert await cache.get(2) is not None
        assert await cache.invalidate_version(99) is False

    asyncio.run(run())


def test_eviction_when_over_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        monkeypatch.setattr(cache_module, "_MAX_SIZE", 2)
        cache = DeploymentDekCache()
        await cache.set(1, _make_fernet())
        await cache.set(2, _make_fernet())
        await cache.set(3, _make_fernet())
        assert await cache.size() == 2
        assert await cache.get(1) is None
        assert await cache.get(3) is not None

    asyncio.run(run())
