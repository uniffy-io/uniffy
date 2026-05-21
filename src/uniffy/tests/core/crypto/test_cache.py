"""OrgDekLRU eviction, TTL, invalidation."""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet

from uniffy.core.crypto import cache as cache_module
from uniffy.core.crypto.cache import OrgDekLRU


def _make_fernet() -> Fernet:
    return Fernet(Fernet.generate_key())


def test_get_returns_none_when_missing() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        assert await lru.get(uuid4(), 1) is None

    asyncio.run(run())


def test_set_get_round_trip() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_id = uuid4()
        f = _make_fernet()
        await lru.set(org_id, 1, f)
        assert await lru.get(org_id, 1) is f

    asyncio.run(run())


def test_get_drops_expired_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_id = uuid4()
        await lru.set(org_id, 1, _make_fernet())
        monkeypatch.setattr(cache_module, "_TTL_SECONDS", -1)
        assert await lru.get(org_id, 1) is None
        assert await lru.size() == 0

    asyncio.run(run())


def test_eviction_when_over_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        monkeypatch.setattr(cache_module, "_MAX_SIZE", 3)
        lru = OrgDekLRU()
        ids = [uuid4() for _ in range(5)]
        for org_id in ids:
            await lru.set(org_id, 1, _make_fernet())
        assert await lru.size() == 3
        assert await lru.get(ids[0], 1) is None
        assert await lru.get(ids[1], 1) is None
        assert await lru.get(ids[-1], 1) is not None

    asyncio.run(run())


def test_invalidate_drops_all_versions_for_org() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_a = uuid4()
        org_b = uuid4()
        await lru.set(org_a, 1, _make_fernet())
        await lru.set(org_a, 2, _make_fernet())
        await lru.set(org_b, 1, _make_fernet())

        dropped = await lru.invalidate(org_a)
        assert dropped == 2
        assert await lru.get(org_a, 1) is None
        assert await lru.get(org_a, 2) is None
        assert await lru.get(org_b, 1) is not None

    asyncio.run(run())


def test_clear_empties_lru() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        await lru.set(uuid4(), 1, _make_fernet())
        await lru.clear()
        assert await lru.size() == 0

    asyncio.run(run())
