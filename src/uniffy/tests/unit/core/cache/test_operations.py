from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from uniffy.core.cache import operations as cache


class FakeValkey:
    def __init__(self) -> None:
        self.values: dict[str, str | bytes] = {}

    async def get(self, key: str) -> str | bytes | None:
        return self.values.get(key)

    async def set(self, key: str, value: str | bytes, *, ex: int) -> None:
        self.values[key] = value


@asynccontextmanager
async def _ops_call(namespace: str, operation: str) -> AsyncIterator[None]:
    del namespace, operation
    yield


@pytest.mark.asyncio
async def test_cache_roundtrip_uses_orjson_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeValkey()
    monkeypatch.setattr(cache, "get_ops_client", lambda: client)
    monkeypatch.setattr(cache, "ops_call", _ops_call)

    value: dict[str, Any] = {"name": "Uniffy", "nested": {"enabled": True}}
    await cache.cache_set("codec:item", value)

    assert client.values["codec:item"] == b'{"name":"Uniffy","nested":{"enabled":true}}'
    assert await cache.cache_get("codec:item") == value


@pytest.mark.asyncio
async def test_cache_reads_existing_stdlib_json(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeValkey()
    client.values["codec:item"] = '{"name": "Uniffy", "count": 2}'
    monkeypatch.setattr(cache, "get_ops_client", lambda: client)
    monkeypatch.setattr(cache, "ops_call", _ops_call)

    assert await cache.cache_get("codec:item") == {"name": "Uniffy", "count": 2}
