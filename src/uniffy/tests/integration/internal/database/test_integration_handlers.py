"""Per-RPC gates for integrations.v1.IntegrationsService.

Only the context getters are patched, so a handler opens its own session
through the real `open_session` exactly as it does on a request. The fixture
commits its seed data, which is what makes it visible to that session.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.integrations.v1.integrations_pb2 import (
    AddConnectionRequest,
    ListConnectionsRequest,
    ListIntegrationProvidersRequest,
    RemoveConnectionRequest,
    ToggleConnectionRequest,
    UpdateConnectionRequest,
    ValidateConnectionRequest,
)

from uniffy.core.types import generate_id
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.handlers import IntegrationsHandlers
from uniffy.domains.integrations.operations import ConnectionOperations
from uniffy.domains.integrations.registry import IntegrationRegistry

pytestmark = pytest.mark.asyncio(loop_scope="session")

_CREDENTIAL = "ghp_" + "a" * 40


class FakeGitHubProvider(IntegrationProvider):
    descriptor = IntegrationDescriptor(
        id="github",
        label="GitHub",
        default_base_url="https://api.github.com",
        credential_placeholder="ghp_...",
        credential_docs_url="https://example.com",
    )

    def __init__(self) -> None:
        self.probe = IntegrationProbeResult(is_valid=True, account_login="octocat")
        self.probe_exc: Exception | None = None

    def build_http_client(self, credential, base_url):
        return MagicMock()

    async def validate(self, credential, base_url):
        if self.probe_exc is not None:
            raise self.probe_exc
        return self.probe

    def tools(self):
        return []


def _registry_for(provider: FakeGitHubProvider) -> IntegrationRegistry:
    registry = IntegrationRegistry()
    registry.register(provider)
    return registry


def _ops_registry(provider: FakeGitHubProvider):
    return patch(
        "uniffy.domains.integrations.operations.get_integration_registry",
        MagicMock(return_value=_registry_for(provider)),
    )


def _handlers_registry(provider: FakeGitHubProvider):
    return patch(
        "uniffy.domains.integrations.handlers.get_integration_registry",
        MagicMock(return_value=_registry_for(provider)),
    )


@contextmanager
def _ctx_as(user_id, org_id):
    """Stand in for the auth context only; the handler opens its own session."""
    with (
        patch(
            "uniffy.domains.integrations.handlers.get_user_id_from_context",
            MagicMock(return_value=user_id),
        ),
        patch(
            "uniffy.domains.auth.context.get_organization_id_from_context",
            MagicMock(return_value=org_id),
        ),
    ):
        yield


async def test_list_connections_reveals_last_error_only_to_admins(session, env) -> None:
    provider = FakeGitHubProvider()
    provider.probe_exc = RuntimeError("upstream said 401")
    with _ops_registry(provider):
        await ConnectionOperations(session).add_connection(
            user_id=env.admin_id,
            organization_id=env.org_id,
            provider="github",
            name="broken",
            credential=_CREDENTIAL,
        )

    handlers = IntegrationsHandlers()
    request = ListConnectionsRequest(organization_id=str(env.org_id))

    with _ctx_as(env.member_id, env.org_id):
        response = await handlers.list_connections(request, MagicMock())
    assert len(response.connections) == 1
    assert response.connections[0].is_valid is False
    assert not response.connections[0].HasField("last_error")

    with _ctx_as(env.admin_id, env.org_id):
        response = await handlers.list_connections(request, MagicMock())
    assert response.connections[0].last_error == "upstream said 401"


def _mutation_call(handlers: IntegrationsHandlers, rpc: str, org_id: str):
    connection_id = str(generate_id())
    if rpc == "add":
        return handlers.add_connection(
            AddConnectionRequest(
                organization_id=org_id,
                provider="github",
                name="mine",
                credential=_CREDENTIAL,
            ),
            MagicMock(),
        )
    if rpc == "update":
        return handlers.update_connection(
            UpdateConnectionRequest(
                organization_id=org_id, connection_id=connection_id, name="renamed"
            ),
            MagicMock(),
        )
    if rpc == "remove":
        return handlers.remove_connection(
            RemoveConnectionRequest(organization_id=org_id, connection_id=connection_id),
            MagicMock(),
        )
    if rpc == "validate":
        return handlers.validate_connection(
            ValidateConnectionRequest(organization_id=org_id, connection_id=connection_id),
            MagicMock(),
        )
    return handlers.toggle_connection(
        ToggleConnectionRequest(organization_id=org_id, connection_id=connection_id, enabled=False),
        MagicMock(),
    )


@pytest.mark.parametrize("rpc", ["add", "update", "remove", "validate", "toggle"])
async def test_admin_mutations_are_denied_for_a_plain_member(rpc: str, session, env) -> None:
    handlers = IntegrationsHandlers()
    with (
        _ops_registry(FakeGitHubProvider()),
        _ctx_as(env.member_id, env.org_id),
        pytest.raises(ConnectError) as exc_info,
    ):
        await _mutation_call(handlers, rpc, str(env.org_id))
    assert exc_info.value.code == Code.PERMISSION_DENIED


async def test_list_integration_providers_returns_the_registered_set(session, env) -> None:
    handlers = IntegrationsHandlers()
    request = ListIntegrationProvidersRequest(organization_id=str(env.org_id))
    with (
        _handlers_registry(FakeGitHubProvider()),
        _ctx_as(env.member_id, env.org_id),
    ):
        response = await handlers.list_integration_providers(request, MagicMock())
    assert [p.id for p in response.providers] == ["github"]
    assert response.providers[0].label == "GitHub"


async def test_list_integration_providers_requires_membership(session, env) -> None:
    handlers = IntegrationsHandlers()
    request = ListIntegrationProvidersRequest(organization_id=str(env.org_id))
    outsider = generate_id()
    with (
        _handlers_registry(FakeGitHubProvider()),
        _ctx_as(outsider, env.org_id),
        pytest.raises(ConnectError) as exc_info,
    ):
        await handlers.list_integration_providers(request, MagicMock())
    assert exc_info.value.code == Code.PERMISSION_DENIED
