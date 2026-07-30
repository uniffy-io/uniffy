"""Advertise-time schema gating and the in-process client LRU.

Connection metadata, the integration registry and the tool registry are
all patched in the tool_gate namespace, so no provider pack is imported
and no store is touched.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import uniffy.domains.integrations.client_cache as client_cache_mod
from uniffy.domains.integrations import tool_gate
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.client_cache import IntegrationClientLRU
from uniffy.domains.integrations.registry import IntegrationRegistry

READ_SCHEMA = {"name": "github-search_issues"}
WRITE_SCHEMA = {"name": "github-create_issue"}
PLATFORM_SCHEMA = {"name": "notes-search_notes"}


def _run(coro):
    return asyncio.run(coro)


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
        "id": str(uuid4()),
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
        lambda: _ToolRegistryStub(
            {"github.search_issues": True, "github.create_issue": False}
        ),
    )


def _filter(monkeypatch, meta: list[dict], schemas):
    async def fake_meta(session, organization_id):
        return meta

    monkeypatch.setattr(tool_gate, "get_org_connections_meta", fake_meta)
    return _run(
        tool_gate.filter_integration_tool_schemas(MagicMock(), uuid4(), schemas)
    )


def test_missing_connection_drops_integration_schemas_only(monkeypatch) -> None:
    filtered = _filter(monkeypatch, [], [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [PLATFORM_SCHEMA]


def test_enabled_valid_connection_keeps_read_schemas(monkeypatch) -> None:
    filtered = _filter(monkeypatch, [_meta_row()], [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [READ_SCHEMA, PLATFORM_SCHEMA]


def test_write_schema_is_dropped_without_a_writable_connection(monkeypatch) -> None:
    filtered = _filter(monkeypatch, [_meta_row()], [READ_SCHEMA, WRITE_SCHEMA])
    assert filtered == [READ_SCHEMA]


def test_write_schema_is_kept_when_a_connection_allows_writes(monkeypatch) -> None:
    filtered = _filter(
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
def test_disabled_or_invalid_connections_count_as_absent(monkeypatch, meta) -> None:
    filtered = _filter(monkeypatch, meta, [READ_SCHEMA, PLATFORM_SCHEMA])
    assert filtered == [PLATFORM_SCHEMA]


@pytest.mark.parametrize("schemas", [None, []], ids=["none", "empty"])
def test_absent_schema_lists_pass_through_unchanged(monkeypatch, schemas) -> None:
    async def fail_meta(session, organization_id):
        raise AssertionError("metadata must not be loaded for empty schema lists")

    monkeypatch.setattr(tool_gate, "get_org_connections_meta", fail_meta)
    result = _run(
        tool_gate.filter_integration_tool_schemas(MagicMock(), uuid4(), schemas)
    )
    assert result is schemas


def test_prompt_filter_drops_unadvertised_integration_tools() -> None:
    kept = tool_gate.filter_enabled_tools_for_prompt(
        ["github.search_issues", "notes.search_notes"],
        [PLATFORM_SCHEMA],
    )
    assert kept == ["notes.search_notes"]


def test_prompt_filter_keeps_advertised_integration_tools() -> None:
    kept = tool_gate.filter_enabled_tools_for_prompt(
        ["github.search_issues", "notes.search_notes"],
        [READ_SCHEMA, PLATFORM_SCHEMA],
    )
    assert kept == ["github.search_issues", "notes.search_notes"]


def test_has_advertised_integration_tools() -> None:
    assert tool_gate.has_advertised_integration_tools([READ_SCHEMA, PLATFORM_SCHEMA])
    assert not tool_gate.has_advertised_integration_tools([PLATFORM_SCHEMA])
    assert not tool_gate.has_advertised_integration_tools([])
    assert not tool_gate.has_advertised_integration_tools(None)


def test_client_lru_round_trips_credential_and_client() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = uuid4()
        client = MagicMock()
        await lru.set(connection_id, "secret", client)
        cached = await lru.get(connection_id)
        assert cached == ("secret", client)
        assert await lru.get(uuid4()) is None

    _run(scenario())


def test_client_lru_expires_entries_after_the_ttl(monkeypatch) -> None:
    clock = SimpleNamespace(now=1_000.0)
    monkeypatch.setattr(
        client_cache_mod, "time", SimpleNamespace(time=lambda: clock.now)
    )

    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = uuid4()
        await lru.set(connection_id, "secret", MagicMock())
        clock.now += client_cache_mod._TTL_SECONDS - 1
        assert await lru.get(connection_id) is not None
        clock.now += 2
        assert await lru.get(connection_id) is None
        assert await lru.size() == 0

    _run(scenario())


def test_client_lru_evicts_the_oldest_entry_beyond_max_size() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        first = uuid4()
        await lru.set(first, "secret", MagicMock())
        for _ in range(client_cache_mod._MAX_SIZE):
            await lru.set(uuid4(), "secret", MagicMock())
        assert await lru.size() == client_cache_mod._MAX_SIZE
        assert await lru.get(first) is None

    _run(scenario())


def test_client_lru_invalidate_reports_whether_an_entry_was_dropped() -> None:
    async def scenario():
        lru = IntegrationClientLRU()
        connection_id = uuid4()
        await lru.set(connection_id, "secret", MagicMock())
        assert await lru.invalidate(connection_id) is True
        assert await lru.invalidate(connection_id) is False

    _run(scenario())
