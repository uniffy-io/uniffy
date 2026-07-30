"""Per-RPC gates for integrations.v1.IntegrationsService.

Context getters and open_session are patched in the handlers namespace;
the operations underneath run against the real database with a fake
provider registry.
"""

import asyncio
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace as NS
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from uniffy_proto.integrations.v1.integrations_pb2 import (
    AddConnectionRequest,
    ListConnectionsRequest,
    ListIntegrationProvidersRequest,
    RemoveConnectionRequest,
    ToggleConnectionRequest,
    UpdateConnectionRequest,
    ValidateConnectionRequest,
)

import uniffy.core.crypto.cache as crypto_cache
from uniffy.core.crypto import OrgCipher
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.db.session import get_database_url
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.handlers import IntegrationsHandlers
from uniffy.domains.integrations.operations import ConnectionOperations
from uniffy.domains.integrations.registry import IntegrationRegistry

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
def _ctx_as(user_id, org_id, session):
    @asynccontextmanager
    async def fake_open_session():
        yield session

    with (
        patch(
            "uniffy.domains.integrations.handlers.get_user_id_from_context",
            MagicMock(return_value=user_id),
        ),
        patch(
            "uniffy.domains.integrations.handlers.get_organization_id_from_context",
            MagicMock(return_value=org_id),
        ),
        patch("uniffy.domains.integrations.handlers.open_session", fake_open_session),
    ):
        yield


async def _seed_env(session: AsyncSession) -> NS:
    suffix = uuid4().hex[:12]
    admin = User(
        email=f"ith-admin-{suffix}@test.local",
        username=f"ith-admin-{suffix}",
        hashed_password="x",
    )
    member = User(
        email=f"ith-member-{suffix}@test.local",
        username=f"ith-member-{suffix}",
        hashed_password="x",
    )
    org = Organization(name=f"ith {suffix}", slug=f"ith-{suffix}")
    session.add_all([admin, member, org])
    await session.flush()
    session.add_all(
        [
            OrganizationMember(
                user_id=admin.id, organization_id=org.id, role=OrganizationRole.ADMIN
            ),
            OrganizationMember(
                user_id=member.id, organization_id=org.id, role=OrganizationRole.MEMBER
            ),
        ]
    )
    await OrgCipher(session).provision(org.id, admin.id)
    await session.commit()
    return NS(org_id=org.id, admin_id=admin.id, member_id=member.id)


async def _teardown_env(session: AsyncSession, env: NS) -> None:
    await session.rollback()
    await session.execute(
        delete(IntegrationConnection).where(
            IntegrationConnection.organization_id == env.org_id
        )
    )
    await session.execute(delete(AuditEvent).where(AuditEvent.organization_id == env.org_id))
    await session.execute(
        delete(OrgEncryptionKey).where(OrgEncryptionKey.organization_id == env.org_id)
    )
    await session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
    )
    await session.execute(delete(Organization).where(Organization.id == env.org_id))
    await session.execute(delete(User).where(User.id.in_([env.admin_id, env.member_id])))
    await session.commit()


def _with_env(body):
    async def runner():
        crypto_cache._lru = None
        engine = create_async_engine(get_database_url(), poolclass=NullPool)
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with maker() as session:
                env = await _seed_env(session)
                try:
                    await body(session, env)
                finally:
                    await _teardown_env(session, env)
        finally:
            await engine.dispose()

    asyncio.run(runner())


def test_list_connections_reveals_last_error_only_to_admins() -> None:
    async def body(session, env):
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

        with _ctx_as(env.member_id, env.org_id, session):
            response = await handlers.list_connections(request, MagicMock())
        assert len(response.connections) == 1
        assert response.connections[0].is_valid is False
        assert not response.connections[0].HasField("last_error")

        with _ctx_as(env.admin_id, env.org_id, session):
            response = await handlers.list_connections(request, MagicMock())
        assert response.connections[0].last_error == "upstream said 401"

    _with_env(body)


def _mutation_call(handlers: IntegrationsHandlers, rpc: str, org_id: str):
    connection_id = str(uuid4())
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
            ValidateConnectionRequest(
                organization_id=org_id, connection_id=connection_id
            ),
            MagicMock(),
        )
    return handlers.toggle_connection(
        ToggleConnectionRequest(
            organization_id=org_id, connection_id=connection_id, enabled=False
        ),
        MagicMock(),
    )


@pytest.mark.parametrize("rpc", ["add", "update", "remove", "validate", "toggle"])
def test_admin_mutations_are_denied_for_a_plain_member(rpc: str) -> None:
    async def body(session, env):
        handlers = IntegrationsHandlers()
        with (
            _ops_registry(FakeGitHubProvider()),
            _ctx_as(env.member_id, env.org_id, session),
            pytest.raises(ConnectError) as exc_info,
        ):
            await _mutation_call(handlers, rpc, str(env.org_id))
        assert exc_info.value.code == Code.PERMISSION_DENIED

    _with_env(body)


def test_request_org_mismatching_the_session_is_a_permission_error() -> None:
    handlers = IntegrationsHandlers()
    request = ListConnectionsRequest(organization_id=str(uuid4()))
    with (
        _ctx_as(uuid4(), uuid4(), MagicMock()),
        pytest.raises(ConnectError) as exc_info,
    ):
        asyncio.run(handlers.list_connections(request, MagicMock()))
    assert exc_info.value.code == Code.PERMISSION_DENIED


@pytest.mark.parametrize("rpc", ["update", "remove", "validate", "toggle"])
def test_malformed_connection_id_is_an_invalid_argument(rpc: str) -> None:
    handlers = IntegrationsHandlers()
    org_id = uuid4()
    requests = {
        "update": UpdateConnectionRequest(
            organization_id=str(org_id), connection_id="not-a-uuid", name="x"
        ),
        "remove": RemoveConnectionRequest(
            organization_id=str(org_id), connection_id="not-a-uuid"
        ),
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
        _ctx_as(uuid4(), org_id, MagicMock()),
        pytest.raises(ConnectError) as exc_info,
    ):
        asyncio.run(handler(requests[rpc], MagicMock()))
    assert exc_info.value.code == Code.INVALID_ARGUMENT


def test_list_integration_providers_returns_the_registered_set() -> None:
    async def body(session, env):
        handlers = IntegrationsHandlers()
        request = ListIntegrationProvidersRequest(organization_id=str(env.org_id))
        with (
            _handlers_registry(FakeGitHubProvider()),
            _ctx_as(env.member_id, env.org_id, session),
        ):
            response = await handlers.list_integration_providers(request, MagicMock())
        assert [p.id for p in response.providers] == ["github"]
        assert response.providers[0].label == "GitHub"

    _with_env(body)


def test_list_integration_providers_requires_membership() -> None:
    async def body(session, env):
        handlers = IntegrationsHandlers()
        request = ListIntegrationProvidersRequest(organization_id=str(env.org_id))
        outsider = uuid4()
        with (
            _handlers_registry(FakeGitHubProvider()),
            _ctx_as(outsider, env.org_id, session),
            pytest.raises(ConnectError) as exc_info,
        ):
            await handlers.list_integration_providers(request, MagicMock())
        assert exc_info.value.code == Code.PERMISSION_DENIED

    _with_env(body)
