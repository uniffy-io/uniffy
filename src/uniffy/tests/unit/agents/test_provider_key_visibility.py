"""What a provider key renders to a caller: hints and admin-only diagnostics."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from uniffy_proto.agents.v1.providers_pb2 import ListProviderKeysRequest

from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.converters import provider_key_to_proto
from uniffy.domains.agents.providers.handlers import ProvidersHandlers
from uniffy.domains.agents.providers.utils import build_key_hint


def _key_row(**overrides):
    now = datetime.now(UTC)
    defaults = dict(
        id=generate_id(),
        provider="anthropic",
        label="Primary",
        key_hint="sk-ant-api03...abcd",
        is_valid=False,
        is_enabled=True,
        created_at=now,
        updated_at=now,
        created_by=generate_id(),
        last_validated_at=now,
        last_used_at=None,
        last_error="401 unauthorized: sk-ant-live-... rejected by upstream",
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_converter_hides_last_error_unless_diagnostics_requested() -> None:
    key = _key_row()

    assert not provider_key_to_proto(key).HasField("last_error")
    assert provider_key_to_proto(key, include_diagnostics=True).last_error == key.last_error


async def _list_keys_as(*, org_admin: bool, keys: list) -> tuple[list, AsyncMock]:
    """Run ListProviderKeys with a stubbed session, ops and role lookup."""
    handlers = ProvidersHandlers()
    request = ListProviderKeysRequest(organization_id=str(generate_id()))
    ops = MagicMock()
    ops.list_keys = AsyncMock(return_value=keys)
    gate = AsyncMock(return_value=org_admin)

    @asynccontextmanager
    async def fake_session():
        yield MagicMock()

    async def run():
        with (
            patch(
                "uniffy.domains.agents.providers.handlers.current_user_id",
                MagicMock(return_value=generate_id()),
            ),
            patch(
                "uniffy.domains.agents.providers.handlers.open_session",
                fake_session,
            ),
            patch(
                "uniffy.domains.agents.providers.handlers.ProviderOperations",
                MagicMock(return_value=ops),
            ),
            patch(
                "uniffy.domains.agents.providers.handlers.is_org_admin",
                gate,
            ),
        ):
            response = await handlers.list_provider_keys(request, MagicMock())
        return list(response.keys)

    return await run(), gate


async def test_list_keys_gives_an_org_admin_the_validation_error() -> None:
    key = _key_row()

    rendered, _ = await _list_keys_as(org_admin=True, keys=[key])

    assert rendered[0].last_error == key.last_error


async def test_list_keys_hides_the_validation_error_from_a_plain_member() -> None:
    key = _key_row()

    rendered, _ = await _list_keys_as(org_admin=False, keys=[key])

    assert not rendered[0].HasField("last_error")
    assert rendered[0].key_hint == key.key_hint
    assert rendered[0].is_valid is False


async def test_role_is_resolved_once_per_rpc_not_per_key() -> None:
    rendered, gate = await _list_keys_as(
        org_admin=False,
        keys=[_key_row(), _key_row(), _key_row()],
    )

    assert len(rendered) == 3
    assert gate.await_count == 1


@pytest.mark.parametrize(
    "credential",
    [
        "a",
        "abcd",
        "abcdefgh",
        "abcdefghij",
        "0123456789abcde",
        "0123456789abcdef",
    ],
)
def test_short_credentials_never_expose_a_prefix(credential: str) -> None:
    hint = build_key_hint(credential)

    assert hint.startswith("...")
    assert credential[:4] not in hint
    assert len(hint.replace("...", "")) <= 4


@pytest.mark.parametrize(
    "credential",
    [
        "sk-ant-api03-0123456x",
        "sk-proj-" + "z" * 90,
    ],
)
def test_long_credentials_keep_the_provider_prefix(credential: str) -> None:
    hint = build_key_hint(credential)

    assert hint == credential[:12] + "..." + credential[-4:]


def test_hint_ignores_surrounding_whitespace() -> None:
    assert build_key_hint("  sk-ant-api03-0123456x  ") == build_key_hint("sk-ant-api03-0123456x")
