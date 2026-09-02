"""Connection rules that hold without a database: base-URL normalization,
converter field gating, and the handler guards that run before any row load.
"""

from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace as NS
from unittest.mock import MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.integrations.v1.integrations_pb2 import (
    ListConnectionsRequest,
    RemoveConnectionRequest,
    ToggleConnectionRequest,
    UpdateConnectionRequest,
    ValidateConnectionRequest,
)

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.integrations.converters import connection_to_proto
from uniffy.domains.integrations.handlers import IntegrationsHandlers
from uniffy.domains.integrations.operations import _normalize_base_url


def _connection_row(**overrides):
    now = datetime.now(UTC)
    defaults = dict(
        id=generate_id(),
        provider="github",
        name="primary",
        base_url=None,
        credential_hint="ghp_aaaaaaaa...aaaa",
        account_login=None,
        allow_writes=False,
        is_valid=False,
        is_enabled=True,
        last_validated_at=None,
        last_used_at=None,
        last_error="401 from upstream",
        created_by=generate_id(),
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return NS(**defaults)


@contextmanager
def _ctx_as(user_id, org_id, session):
    @asynccontextmanager
    async def fake_open_session():
        yield session

    with (
        patch(
            "uniffy.domains.integrations.handlers.current_user_id",
            MagicMock(return_value=user_id),
        ),
        patch(
            "uniffy.core.auth.principal.current_organization_id",
            MagicMock(return_value=org_id),
        ),
        patch("uniffy.domains.integrations.handlers.open_session", fake_open_session),
    ):
        yield


def test_base_url_trailing_slash_is_stripped() -> None:
    assert _normalize_base_url("https://ghe.example.com/api/v3/") == "https://ghe.example.com/api/v3"


def test_base_url_empty_string_means_provider_default() -> None:
    assert _normalize_base_url("") is None
    assert _normalize_base_url("   ") is None
    assert _normalize_base_url(None) is None


@pytest.mark.parametrize(
    "raw",
    [
        "ftp://ghe.example.com",
        "https://",
        "https://user:pw@ghe.example.com",
        "https://ghe.example.com/api?x=1",
    ],
    ids=["scheme", "missing-host", "userinfo", "query"],
)
def test_base_url_rejects_unsafe_shapes(raw: str) -> None:
    with pytest.raises(ValidationError):
        _normalize_base_url(raw)


def test_converter_hides_last_error_unless_diagnostics_requested() -> None:
    row = _connection_row()

    assert not connection_to_proto(row).HasField("last_error")
    assert connection_to_proto(row, include_diagnostics=True).last_error == row.last_error


def test_converter_leaves_optional_fields_unset_when_none() -> None:
    row = _connection_row()

    info = connection_to_proto(row)
    assert not info.HasField("base_url")
    assert not info.HasField("account_login")
    assert not info.HasField("last_validated_at")
    assert not info.HasField("last_used_at")

    populated = connection_to_proto(
        _connection_row(base_url="https://ghe.example.com/api/v3", account_login="octocat")
    )
    assert populated.base_url == "https://ghe.example.com/api/v3"
    assert populated.account_login == "octocat"


async def test_request_org_mismatching_the_session_is_a_permission_error() -> None:
    handlers = IntegrationsHandlers()
    request = ListConnectionsRequest(organization_id=str(generate_id()))
    with (
        _ctx_as(generate_id(), generate_id(), MagicMock()),
        pytest.raises(ConnectError) as exc_info,
    ):
        await handlers.list_connections(request, MagicMock())
    assert exc_info.value.code == Code.PERMISSION_DENIED


@pytest.mark.parametrize("rpc", ["update", "remove", "validate", "toggle"])
async def test_malformed_connection_id_is_an_invalid_argument(rpc: str) -> None:
    handlers = IntegrationsHandlers()
    org_id = generate_id()
    requests = {
        "update": UpdateConnectionRequest(
            organization_id=str(org_id), connection_id="not-a-uuid", name="x"
        ),
        "remove": RemoveConnectionRequest(organization_id=str(org_id), connection_id="not-a-uuid"),
        "validate": ValidateConnectionRequest(
            organization_id=str(org_id), connection_id="not-a-uuid"
        ),
        "toggle": ToggleConnectionRequest(
            organization_id=str(org_id), connection_id="not-a-uuid", enabled=True
        ),
    }
    handler = {
        "update": handlers.update_connection,
        "remove": handlers.remove_connection,
        "validate": handlers.validate_connection,
        "toggle": handlers.toggle_connection,
    }[rpc]
    with (
        _ctx_as(generate_id(), org_id, MagicMock()),
        pytest.raises(ConnectError) as exc_info,
    ):
        await handler(requests[rpc], MagicMock())
    assert exc_info.value.code == Code.INVALID_ARGUMENT
