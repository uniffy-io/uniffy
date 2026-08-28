"""Advertise-time schema gating and the in-process client LRU.

Connection metadata, the integration registry and the tool registry are
all patched in the tool_gate namespace, so no provider pack is imported
and no store is touched.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import uniffy.domains.integrations.clients as client_cache_mod
from uniffy.core.types import generate_id
from uniffy.domains.integrations import tools as tool_gate
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.clients import IntegrationClientLRU
from uniffy.domains.integrations.registry import IntegrationRegistry

READ_SCHEMA = {"name": "github-search_issues"}
WRITE_SCHEMA = {"name": "github-create_issue"}
PLATFORM_SCHEMA = {"name": "notes-search_notes"}


class FakeGitHubProvider(IntegrationProvider):
    descriptor = IntegrationDescriptor(
        id="github",
        label="GitHub",
        default_base_url="https://api.github.com",
        credential_placeholder="ghp_...",
        credential_docs_url="https://example.com",
    )

    def build_http_client(self, credential, base_url):
        return MagicMock()

    async def validate(self, credential, base_url):
        return IntegrationProbeResult(is_valid=True)

    def tools(self):
        return []


class _ToolRegistryStub:
    def __init__(self, read_only: dict[str, bool]) -> None:
        self._read_only = read_only

    def get(self, name: str):
        if name not in self._read_only:
            return None
        return SimpleNamespace(read_only=self._read_only[name])


def _meta_row(**overrides) -> dict:
    row = {
        "id": str(generate_id()),
        "provider": "github",
        "name": "main",
        "allow_writes": False,
        "is_valid": True,
        "is_enabled": True,
    }
    row.update(overrides)
    return row


@pytest.fixture(autouse=True)
def _patched_gate(monkeypatch):
    registry = IntegrationRegistry()
    registry.register(FakeGitHubProvider())
    monkeypatch.setattr(tool_gate, "get_integration_registry", lambda: registry)
    monkeypatch.setattr(
        tool_gate,
        "get_tool_registry",
        lambda: _ToolRegistryStub({"github.search_issues": True, "github.create_issue": False}),
    )


async def _filter(monkeypatch, meta: list[dict], schemas):
    async def fake_meta(session, organization_id):
        return meta

    monkeypatch.setattr(tool_gate, "get_org_connections_meta", fake_meta)
    return await tool_gate.filter_integration_tool_schemas(MagicMock(), generate_id(), schemas)


async def test_missing_connection_drops_integration_schemas_only(monkeypatch) -> None:
    filtered = await _filter(monkeypatch, [], [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [PLATFORM_SCHEMA]


async def test_enabled_valid_connection_keeps_read_schemas(monkeypatch) -> None:
    filtered = await _filter(monkeypatch, [_meta_row()], [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [READ_SCHEMA, PLATFORM_SCHEMA]


async def test_write_schema_is_dropped_without_a_writable_connection(monkeypatch) -> None:
    filtered = await _filter(monkeypatch, [_meta_row()], [READ_SCHEMA, WRITE_SCHEMA])
    assert filtered == [READ_SCHEMA]


async def test_write_schema_is_kept_when_a_connection_allows_writes(monkeypatch) -> None:
    filtered = await _filter(
        monkeypatch, [_meta_row(allow_writes=True)], [READ_SCHEMA, WRITE_SCHEMA]
    )
    assert filtered == [READ_SCHEMA, WRITE_SCHEMA]


@pytest.mark.parametrize(
    "meta",
    [
        [_meta_row(is_enabled=False)],
        [_meta_row(is_valid=False)],
    ],
    ids=["disabled", "invalid"],
)
async def test_disabled_or_invalid_connections_count_as_absent(monkeypatch, meta) -> None:
    filtered = await _filter(monkeypatch, meta, [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [PLATFORM_SCHEMA]


@pytest.mark.parametrize("schemas", [None, []], ids=["none", "empty"])
async def test_absent_schema_lists_pass_through_unchanged(monkeypatch, schemas) -> None:
    async def fail_meta(session, organization_id):
        raise AssertionError("metadata must not be loaded for empty schema lists")

    monkeypatch.setattr(tool_gate, "get_org_connections_meta", fail_meta)
    result = await tool_gate.filter_integration_tool_schemas(MagicMock(), generate_id(), schemas)
    assert result is schemas


def test_has_advertised_integration_tools() -> None:
    assert tool_gate.has_advertised_integration_tools([READ_SCHEMA, PLATFORM_SCHEMA])
    assert not tool_gate.has_advertised_integration_tools([PLATFORM_SCHEMA])
    assert not tool_gate.has_advertised_integration_tools([])
    assert not tool_gate.has_advertised_integration_tools(None)


async def test_client_lru_round_trips_credential_and_client() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = generate_id()
        client = MagicMock()
        await lru.set(connection_id, "secret", client)
        cached = await lru.get(connection_id)
        assert cached == ("secret", client)
        assert await lru.get(generate_id()) is None

    await scenario()


async def test_client_lru_expires_entries_after_the_ttl(monkeypatch) -> None:
    clock = SimpleNamespace(now=1_000.0)
    monkeypatch.setattr(client_cache_mod, "time", SimpleNamespace(time=lambda: clock.now))

    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = generate_id()
        await lru.set(connection_id, "secret", MagicMock())
        clock.now += client_cache_mod._TTL_SECONDS - 1
        assert await lru.get(connection_id) is not None
        clock.now += 2
        assert await lru.get(connection_id) is None
        assert await lru.size() == 0

    await scenario()


async def test_client_lru_evicts_the_oldest_entry_beyond_max_size() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        first = generate_id()
        await lru.set(first, "secret", MagicMock())
        for _ in range(client_cache_mod._MAX_SIZE):
            await lru.set(generate_id(), "secret", MagicMock())
        assert await lru.size() == client_cache_mod._MAX_SIZE
        assert await lru.get(first) is None

    await scenario()


async def test_client_lru_invalidate_reports_whether_an_entry_was_dropped() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = generate_id()
        await lru.set(connection_id, "secret", MagicMock())
        assert await lru.invalidate(connection_id) is True
        assert await lru.invalidate(connection_id) is False

    await scenario()
