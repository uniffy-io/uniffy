"""OrgDekLRU eviction, TTL, invalidation."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from uniffy.core.crypto import cache as cache_module
from uniffy.core.crypto.cache import OrgDekLRU
from uniffy.core.types import generate_id


def _make_fernet() -> Fernet:
    return Fernet(Fernet.generate_key())


async def test_get_returns_none_when_missing() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        assert await lru.get(generate_id(), 1) is None

    await run()


async def test_set_get_round_trip() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_id = generate_id()
        f = _make_fernet()
        await lru.set(org_id, 1, f)
        assert await lru.get(org_id, 1) is f

    await run()


async def test_get_drops_expired_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_id = generate_id()
        await lru.set(org_id, 1, _make_fernet())
        monkeypatch.setattr(cache_module, "_TTL_SECONDS", -1)
        assert await lru.get(org_id, 1) is None
        assert await lru.size() == 0

    await run()


async def test_eviction_when_over_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        monkeypatch.setattr(cache_module, "_MAX_SIZE", 3)
        lru = OrgDekLRU()
        ids = [generate_id() for _ in range(5)]
        for org_id in ids:
            await lru.set(org_id, 1, _make_fernet())
        assert await lru.size() == 3
        assert await lru.get(ids[0], 1) is None
        assert await lru.get(ids[1], 1) is None
        assert await lru.get(ids[-1], 1) is not None

    await run()


async def test_invalidate_drops_all_versions_for_org() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        org_a = generate_id()
        org_b = generate_id()
        await lru.set(org_a, 1, _make_fernet())
        await lru.set(org_a, 2, _make_fernet())
        await lru.set(org_b, 1, _make_fernet())

        dropped = await lru.invalidate(org_a)
        assert dropped == 2
        assert await lru.get(org_a, 1) is None
        assert await lru.get(org_a, 2) is None
        assert await lru.get(org_b, 1) is not None

    await run()


async def test_clear_empties_lru() -> None:
    async def run() -> None:
        lru = OrgDekLRU()
        await lru.set(generate_id(), 1, _make_fernet())
        await lru.clear()
        assert await lru.size() == 0

    await run()
