"""ConnectionOperations against the real database.

Each test seeds its own org, admin and member, provisions the org DEK,
and removes everything it created. The integration registry is patched
with a fake provider so no provider pack is imported.
"""

import asyncio
import contextlib
from datetime import UTC, datetime
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import uniffy.core.crypto.cache as crypto_cache
from uniffy.core.crypto import OrgCipher
from uniffy.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.db.session import get_database_url
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.converters import connection_to_proto
from uniffy.domains.integrations.operations import ConnectionOperations, _normalize_base_url
from uniffy.domains.integrations.registry import IntegrationRegistry

_CREDENTIAL = "ghp_" + "a" * 40
_ROTATED_CREDENTIAL = "ghp_" + "b" * 40


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
        self.validate_calls: list[tuple[str, str | None]] = []

    def build_http_client(self, credential, base_url):
        return MagicMock()

    async def validate(self, credential, base_url):
        self.validate_calls.append((credential, base_url))
        if self.probe_exc is not None:
            raise self.probe_exc
        return self.probe

    def tools(self):
        return []


class FakeGitLabProvider(FakeGitHubProvider):
    descriptor = IntegrationDescriptor(
        id="gitlab",
        label="GitLab",
        default_base_url="https://gitlab.com/api/v4",
        credential_placeholder="glpat-...",
        credential_docs_url="https://example.com",
    )


def _registry(*providers: FakeGitHubProvider):
    registry = IntegrationRegistry()
    for provider in providers:
        registry.register(provider)
    mock = MagicMock(return_value=registry)
    stack = contextlib.ExitStack()
    stack.enter_context(
        patch("uniffy.domains.integrations.operations.get_integration_registry", mock)
    )
    stack.enter_context(
        patch("uniffy.domains.agents.agents.operations.get_integration_registry", mock)
    )
    return stack


async def _seed_env(session: AsyncSession) -> NS:
    suffix = uuid4().hex[:12]
    admin = User(
        email=f"itc-admin-{suffix}@test.local",
        username=f"itc-admin-{suffix}",
        hashed_password="x",
    )
    member = User(
        email=f"itc-member-{suffix}@test.local",
        username=f"itc-member-{suffix}",
        hashed_password="x",
    )
    org = Organization(name=f"itc {suffix}", slug=f"itc-{suffix}")
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
    await session.execute(delete(Agent).where(Agent.organization_id == env.org_id))
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


def _with_session(body):
    async def runner():
        # The DEK LRU lock binds to the first event loop that touches it,
        # so each asyncio.run gets a fresh cache.
        crypto_cache._lru = None
        engine = create_async_engine(get_database_url(), poolclass=NullPool)
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with maker() as session:
                await body(session)
        finally:
            await engine.dispose()

    asyncio.run(runner())


def _with_env(body):
    async def scenario(session):
        env = await _seed_env(session)
        try:
            await body(session, env)
        finally:
            await _teardown_env(session, env)

    _with_session(scenario)


async def _add(session, env, *, name="primary", credential=_CREDENTIAL, **kwargs):
    return await ConnectionOperations(session).add_connection(
        user_id=env.admin_id,
        organization_id=env.org_id,
        provider="github",
        name=name,
        credential=credential,
        **kwargs,
    )


def test_add_connection_round_trips_the_credential_through_org_cipher() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        assert _CREDENTIAL not in row.encrypted_credential
        assert row.encrypted_credential.startswith("v1:")
        decrypted = await OrgCipher(session).decrypt(env.org_id, row.encrypted_credential)
        assert decrypted == _CREDENTIAL

    _with_env(body)


def test_add_connection_masks_the_credential_hint() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        assert row.credential_hint == _CREDENTIAL[:12] + "..." + _CREDENTIAL[-4:]
        assert _CREDENTIAL not in row.credential_hint

    _with_env(body)


def test_probe_success_fills_account_login_and_validity() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        assert row.is_valid is True
        assert row.account_login == "octocat"
        assert row.last_error is None
        assert row.last_validated_at is not None

    _with_env(body)


def test_probe_exception_still_stores_the_row_as_invalid() -> None:
    async def body(session, env):
        provider = FakeGitHubProvider()
        provider.probe_exc = RuntimeError("connect timeout")
        with _registry(provider):
            row = await _add(session, env)
        assert row.id is not None
        assert row.is_valid is False
        assert row.last_error == "connect timeout"

    _with_env(body)


def test_probe_reported_failure_still_stores_the_row_as_invalid() -> None:
    async def body(session, env):
        provider = FakeGitHubProvider()
        provider.probe = IntegrationProbeResult(is_valid=False, error="bad credentials")
        with _registry(provider):
            row = await _add(session, env)
        rows = await ConnectionOperations(session).list_connections(
            user_id=env.admin_id, organization_id=env.org_id
        )
        assert [r.id for r in rows] == [row.id]
        assert row.is_valid is False
        assert row.last_error == "bad credentials"

    _with_env(body)


def test_duplicate_name_for_the_same_org_and_provider_conflicts() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="main")
            with pytest.raises(ConflictError):
                await _add(session, env, name="main")

    _with_env(body)


def test_the_same_name_on_another_org_is_allowed() -> None:
    async def body(session):
        env_a = await _seed_env(session)
        env_b = await _seed_env(session)
        try:
            with _registry(FakeGitHubProvider()):
                await _add(session, env_a, name="main")
                row_b = await _add(session, env_b, name="main")
            assert row_b.organization_id == env_b.org_id
        finally:
            await _teardown_env(session, env_a)
            await _teardown_env(session, env_b)

    _with_session(body)


def test_base_url_trailing_slash_is_stripped() -> None:
    assert (
        _normalize_base_url("https://ghe.example.com/api/v3/")
        == "https://ghe.example.com/api/v3"
    )


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


_MEMBER_MUTATIONS = [
    pytest.param(
        lambda ops, env, cid: ops.remove_connection(
            user_id=env.member_id, organization_id=env.org_id, connection_id=cid
        ),
        id="remove",
    ),
    pytest.param(
        lambda ops, env, cid: ops.toggle_connection(
            user_id=env.member_id,
            organization_id=env.org_id,
            connection_id=cid,
            enabled=False,
        ),
        id="toggle",
    ),
    pytest.param(
        lambda ops, env, cid: ops.update_connection(
            user_id=env.member_id,
            organization_id=env.org_id,
            connection_id=cid,
            name="renamed",
        ),
        id="update",
    ),
    pytest.param(
        lambda ops, env, cid: ops.validate_connection(
            user_id=env.member_id, organization_id=env.org_id, connection_id=cid
        ),
        id="validate",
    ),
]


@pytest.mark.parametrize("call", _MEMBER_MUTATIONS)
def test_admin_gate_runs_before_the_row_load(call) -> None:
    """A member probing a random id gets a permission error, not an existence oracle."""

    async def body(session, env):
        ops = ConnectionOperations(session)
        with pytest.raises(PermissionDeniedError):
            await call(ops, env, uuid4())

    _with_env(body)


def test_admin_gets_not_found_for_a_missing_row() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with pytest.raises(NotFoundError):
            await ops.toggle_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=uuid4(),
                enabled=False,
            )

    _with_env(body)


def test_member_cannot_add_a_connection() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()), pytest.raises(PermissionDeniedError):
            await ConnectionOperations(session).add_connection(
                user_id=env.member_id,
                organization_id=env.org_id,
                provider="github",
                name="mine",
                credential=_CREDENTIAL,
            )

    _with_env(body)


def test_member_can_list_connections() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        rows = await ConnectionOperations(session).list_connections(
            user_id=env.member_id, organization_id=env.org_id
        )
        assert [r.id for r in rows] == [row.id]

    _with_env(body)


def test_toggle_flips_is_enabled() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        assert row.is_enabled is True
        row = await ops.toggle_connection(
            user_id=env.admin_id,
            organization_id=env.org_id,
            connection_id=row.id,
            enabled=False,
        )
        assert row.is_enabled is False
        row = await ops.toggle_connection(
            user_id=env.admin_id,
            organization_id=env.org_id,
            connection_id=row.id,
            enabled=True,
        )
        assert row.is_enabled is True

    _with_env(body)


def test_validate_connection_overwrites_state_in_both_directions() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        provider = FakeGitHubProvider()
        with _registry(provider):
            row = await _add(session, env)
            assert row.is_valid is True

            provider.probe_exc = RuntimeError("token revoked")
            row = await ops.validate_connection(
                user_id=env.admin_id, organization_id=env.org_id, connection_id=row.id
            )
            assert row.is_valid is False
            assert row.last_error == "token revoked"

            provider.probe_exc = None
            provider.probe = IntegrationProbeResult(is_valid=True, account_login="hubot")
            row = await ops.validate_connection(
                user_id=env.admin_id, organization_id=env.org_id, connection_id=row.id
            )
            assert row.is_valid is True
            assert row.last_error is None
            assert row.account_login == "hubot"

    _with_env(body)


def test_update_rename_applies_the_duplicate_check() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="alpha")
            beta = await _add(session, env, name="beta")
            with pytest.raises(ConflictError):
                await ops.update_connection(
                    user_id=env.admin_id,
                    organization_id=env.org_id,
                    connection_id=beta.id,
                    name="alpha",
                )
            renamed = await ops.update_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=beta.id,
                name="gamma",
            )
            assert renamed.name == "gamma"

    _with_env(body)


def test_update_sets_and_clears_the_base_url() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
            row = await ops.update_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=row.id,
                base_url="https://ghe.example.com/api/v3/",
            )
            assert row.base_url == "https://ghe.example.com/api/v3"
            row = await ops.update_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=row.id,
                base_url="",
            )
            assert row.base_url is None

    _with_env(body)


def test_update_credential_rotation_reprobes_and_changes_the_hint() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        provider = FakeGitHubProvider()
        with _registry(provider):
            row = await _add(session, env)
            old_hint = row.credential_hint
            row = await ops.update_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=row.id,
                credential=_ROTATED_CREDENTIAL,
            )
        assert row.credential_hint != old_hint
        assert row.credential_hint == (
            _ROTATED_CREDENTIAL[:12] + "..." + _ROTATED_CREDENTIAL[-4:]
        )
        assert provider.validate_calls[-1][0] == _ROTATED_CREDENTIAL
        decrypted = await OrgCipher(session).decrypt(env.org_id, row.encrypted_credential)
        assert decrypted == _ROTATED_CREDENTIAL

    _with_env(body)


def test_resolve_with_no_usable_connection_names_the_admin_fix() -> None:
    async def body(session, env):
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github"
            )
        assert "Admin > Integrations" in str(exc_info.value)

    _with_env(body)


def test_resolve_returns_the_single_usable_connection() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        meta = await ConnectionOperations(session).resolve_connection(
            organization_id=env.org_id, provider="github"
        )
        assert meta["id"] == str(row.id)
        assert meta["name"] == "primary"

    _with_env(body)


def test_resolve_with_two_usable_connections_lists_both_names() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="alpha")
            await _add(session, env, name="beta")
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github"
            )
        message = str(exc_info.value)
        assert "alpha" in message
        assert "beta" in message

    _with_env(body)


def test_resolve_by_name_matches() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="alpha")
            beta = await _add(session, env, name="beta")
        meta = await ConnectionOperations(session).resolve_connection(
            organization_id=env.org_id, provider="github", name="beta"
        )
        assert meta["id"] == str(beta.id)

    _with_env(body)


def test_resolve_named_disabled_connection_names_the_reason() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env, name="alpha")
            await ops.toggle_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=row.id,
                enabled=False,
            )
        with pytest.raises(ValidationError) as exc_info:
            await ops.resolve_connection(
                organization_id=env.org_id, provider="github", name="alpha"
            )
        assert "disabled" in str(exc_info.value)

    _with_env(body)


def test_resolve_named_invalid_connection_names_the_reason() -> None:
    async def body(session, env):
        provider = FakeGitHubProvider()
        provider.probe = IntegrationProbeResult(is_valid=False, error="expired")
        with _registry(provider):
            await _add(session, env, name="alpha")
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github", name="alpha"
            )
        assert "marked invalid" in str(exc_info.value)

    _with_env(body)


def test_resolve_unknown_name_lists_the_available_connections() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="alpha")
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github", name="ghost"
            )
        message = str(exc_info.value)
        assert "ghost" in message
        assert "alpha" in message

    _with_env(body)


def test_resolve_pinned_id_beats_the_ambiguity_error() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            alpha = await _add(session, env, name="alpha")
            await _add(session, env, name="beta")
        meta = await ConnectionOperations(session).resolve_connection(
            organization_id=env.org_id, provider="github", connection_id=alpha.id
        )
        assert meta["id"] == str(alpha.id)
        assert meta["name"] == "alpha"

    _with_env(body)


def test_resolve_pinned_disabled_connection_points_at_admin() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env, name="alpha")
            await ops.toggle_connection(
                user_id=env.admin_id,
                organization_id=env.org_id,
                connection_id=row.id,
                enabled=False,
            )
        with pytest.raises(ValidationError) as exc_info:
            await ops.resolve_connection(
                organization_id=env.org_id, provider="github", connection_id=row.id
            )
        message = str(exc_info.value)
        assert "pinned to this agent is disabled" in message
        assert "Admin > Integrations" in message

    _with_env(body)


def test_resolve_pinned_invalid_connection_points_at_admin() -> None:
    async def body(session, env):
        provider = FakeGitHubProvider()
        provider.probe = IntegrationProbeResult(is_valid=False, error="expired")
        with _registry(provider):
            row = await _add(session, env, name="alpha")
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github", connection_id=row.id
            )
        message = str(exc_info.value)
        assert "pinned to this agent is marked invalid" in message
        assert "Admin > Integrations" in message

    _with_env(body)


def test_resolve_pinned_missing_id_points_at_the_capabilities_tab() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            await _add(session, env, name="alpha")
        with pytest.raises(ValidationError) as exc_info:
            await ConnectionOperations(session).resolve_connection(
                organization_id=env.org_id, provider="github", connection_id=uuid4()
            )
        message = str(exc_info.value)
        assert "no longer exists" in message
        assert "Capabilities tab" in message

    _with_env(body)


def test_resolve_explicit_name_beats_the_pin() -> None:
    async def body(session, env):
        with _registry(FakeGitHubProvider()):
            alpha = await _add(session, env, name="alpha")
            beta = await _add(session, env, name="beta")
        meta = await ConnectionOperations(session).resolve_connection(
            organization_id=env.org_id,
            provider="github",
            name="beta",
            connection_id=alpha.id,
        )
        assert meta["id"] == str(beta.id)

    _with_env(body)


def test_touch_last_used_throttles_repeat_writes() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        assert row.last_used_at is None
        await ops.touch_last_used(row.id)
        await session.refresh(row)
        first = row.last_used_at
        assert first is not None
        await ops.touch_last_used(row.id)
        await session.refresh(row)
        assert row.last_used_at == first

    _with_env(body)


def test_mark_connection_invalid_records_the_error() -> None:
    async def body(session, env):
        ops = ConnectionOperations(session)
        with _registry(FakeGitHubProvider()):
            row = await _add(session, env)
        await ops.mark_connection_invalid(row.id, env.org_id, "upstream rejected the token")
        await session.refresh(row)
        assert row.is_valid is False
        assert row.last_error == "upstream rejected the token"

    _with_env(body)


def _connection_row(**overrides):
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid4(),
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
        created_by=uuid4(),
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return NS(**defaults)


def test_converter_hides_last_error_unless_diagnostics_requested() -> None:
    row = _connection_row()

    assert not connection_to_proto(row).HasField("last_error")
    assert (
        connection_to_proto(row, include_diagnostics=True).last_error == row.last_error
    )


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


def _agent_ops(session) -> AgentOperations:
    ops = AgentOperations(session)
    # Meilisearch stays out of these tests; the pin lives in PG.
    ops._index_for_search = AsyncMock()
    return ops


class TestAgentConnectionPins:
    """Write-time validation and persistence of ``Agent.integration_connections``."""

    async def _create(self, session, env, mapping):
        return await _agent_ops(session).create_agent(
            user_id=env.admin_id,
            organization_id=env.org_id,
            name="Pinned",
            integration_connections=mapping,
        )

    def test_create_rejects_an_unknown_provider_key(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider()):
                row = await _add(session, env)
                with pytest.raises(ValidationError) as exc_info:
                    await self._create(session, env, {"jira": str(row.id)})
            assert "jira" in str(exc_info.value)

        _with_env(body)

    def test_create_rejects_a_non_uuid_value(self) -> None:
        async def body(session, env):
            with (
                _registry(FakeGitHubProvider()),
                pytest.raises(ValidationError) as exc_info,
            ):
                await self._create(session, env, {"github": "not-a-uuid"})
            assert "must be a UUID" in str(exc_info.value)

        _with_env(body)

    def test_create_rejects_a_cross_org_connection(self) -> None:
        async def body(session):
            env_a = await _seed_env(session)
            env_b = await _seed_env(session)
            try:
                with _registry(FakeGitHubProvider()):
                    foreign = await _add(session, env_b)
                    with pytest.raises(ValidationError) as exc_info:
                        await self._create(session, env_a, {"github": str(foreign.id)})
                assert "in this organization" in str(exc_info.value)
            finally:
                await _teardown_env(session, env_a)
                await _teardown_env(session, env_b)

        _with_session(body)

    def test_create_rejects_a_wrong_provider_connection(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider(), FakeGitLabProvider()):
                row = await _add(session, env)
                with pytest.raises(ValidationError) as exc_info:
                    await self._create(session, env, {"gitlab": str(row.id)})
            message = str(exc_info.value)
            assert "belongs to provider 'github'" in message

        _with_env(body)

    def test_valid_mapping_round_trips_through_create_and_get(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider()):
                row = await _add(session, env)
                agent = await self._create(session, env, {"github": str(row.id)})
            assert agent.integration_connections == {"github": str(row.id)}
            fetched = await _agent_ops(session).get_by_id(
                env.admin_id, env.org_id, agent.id
            )
            assert fetched.integration_connections == {"github": str(row.id)}

        _with_env(body)

    def test_disabled_connection_is_accepted_at_write_time(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider()):
                row = await _add(session, env)
                await ConnectionOperations(session).toggle_connection(
                    user_id=env.admin_id,
                    organization_id=env.org_id,
                    connection_id=row.id,
                    enabled=False,
                )
                agent = await self._create(session, env, {"github": str(row.id)})
            assert agent.integration_connections == {"github": str(row.id)}

        _with_env(body)

    def test_update_absent_leaves_the_pin_and_empty_dict_clears_it(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider()):
                row = await _add(session, env)
                agent = await self._create(session, env, {"github": str(row.id)})
                ops = _agent_ops(session)
                renamed = await ops.update_agent(
                    user_id=env.admin_id,
                    organization_id=env.org_id,
                    agent_id=agent.id,
                    name="Renamed",
                )
                assert renamed.integration_connections == {"github": str(row.id)}
                cleared = await ops.update_agent(
                    user_id=env.admin_id,
                    organization_id=env.org_id,
                    agent_id=agent.id,
                    integration_connections={},
                )
                assert cleared.integration_connections == {}

        _with_env(body)

    def test_update_rejects_an_unknown_provider_key(self) -> None:
        async def body(session, env):
            with _registry(FakeGitHubProvider()):
                row = await _add(session, env)
                agent = await self._create(session, env, None)
                with pytest.raises(ValidationError) as exc_info:
                    await _agent_ops(session).update_agent(
                        user_id=env.admin_id,
                        organization_id=env.org_id,
                        agent_id=agent.id,
                        integration_connections={"jira": str(row.id)},
                    )
            assert "jira" in str(exc_info.value)

        _with_env(body)
