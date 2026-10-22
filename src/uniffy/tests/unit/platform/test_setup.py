"""First-run setup creates the operator and the first organization exactly once."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_pb import GetAuthConfigRequest, SetupDeploymentRequest

from uniffy.core.audit.actions import Action
from uniffy.core.auth.setup_state import setup_required
from uniffy.core.errors import RateLimitExceededError, SetupAlreadyCompletedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationMemberSource
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.auth.handlers import AuthHandlers
from uniffy.domains.auth.types import AuthResult
from uniffy.domains.platform import setup
from uniffy.domains.platform.bootstrap import BOOTSTRAP_LOCK_ID
from uniffy.transport.rpc import SETUP_COMPLETED_REASON, error_info_detail, with_domain_details

_MODULE = "uniffy.domains.platform.setup"
_HANDLERS = "uniffy.domains.auth.handlers"

_EMAIL = "ops@example.com"
_LOCAL_PART = "ops"
_HASHED = "hashed"
_ORG_NAME = "Acme Labs"
_SLUG = "acme-labs"
_SHORT_SLUG = "acme"
_FULL_NAME = "Grace Hopper"
_USER_AGENT = "Mozilla/5.0"
_ACCESS = "access"
_COOKIE = "asset=token"
_INTERNAL = "Internal server error"
_LOCK_FUNCTION = "pg_advisory_xact_lock"

_VALID: dict[str, str | None] = {
    "email": "  Ops@Example.com ",
    "password": "correct-horse-battery",
    "full_name": None,
    "organization_name": " Acme Labs ",
    "organization_slug": None,
    "user_agent": _USER_AGENT,
}


def _result(value: object) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _session(existing_user_id: object | None = None) -> MagicMock:
    """Answers the unlocked check, the lock, then the locked re-check, in that order."""
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_result(None), MagicMock(), _result(existing_user_id)])
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    return session


@dataclass
class Collaborators:
    session: MagicMock
    opened: MagicMock
    organizations: MagicMock
    auth: AsyncMock
    audit: AsyncMock
    vapid: AsyncMock
    rate_limit: AsyncMock
    client_ip: MagicMock
    hash_password: MagicMock
    organization: SimpleNamespace
    staged: SimpleNamespace
    auth_result: AuthResult


@pytest.fixture
def collaborators() -> Iterator[Collaborators]:
    session = _session()
    opened = MagicMock()

    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        opened()
        yield session

    organization = SimpleNamespace(id=generate_id(), slug="acme-labs")
    staged = SimpleNamespace(organization=organization)
    organizations = MagicMock()
    organizations.stage_organization = AsyncMock(return_value=staged)
    organizations.finish_organization_create_after_commit = AsyncMock()

    auth_result = AuthResult(
        access_token="access",
        refresh_token="refresh",
        user_id=generate_id(),
        organization_id=organization.id,
        organization_slug=organization.slug,
        organization_role="OWNER",
        session_id=generate_id(),
        domain_admin_domains=[],
    )
    auth = AsyncMock(return_value=auth_result)

    found = Collaborators(
        session=session,
        opened=opened,
        organizations=organizations,
        auth=auth,
        audit=AsyncMock(),
        vapid=AsyncMock(),
        rate_limit=AsyncMock(),
        client_ip=MagicMock(return_value=None),
        hash_password=MagicMock(return_value="hashed"),
        organization=organization,
        staged=staged,
        auth_result=auth_result,
    )
    with (
        patch(f"{_MODULE}.open_session", open_session),
        patch(f"{_MODULE}.OrganizationOperations", MagicMock(return_value=organizations)),
        patch(f"{_MODULE}.stage_bootstrap_authentication", auth),
        patch(f"{_MODULE}.write_audit_event", found.audit),
        patch(f"{_MODULE}.seed_vapid_keys", found.vapid),
        patch(f"{_MODULE}.check_rate_limit", found.rate_limit),
        patch(f"{_MODULE}.client_ip_for_rate_limit", found.client_ip),
        patch(f"{_MODULE}.hash_password", found.hash_password),
        patch(f"{_MODULE}.ensure_slug_available", AsyncMock()),
    ):
        yield found


async def _run(**overrides: str | None) -> AuthResult:
    arguments = {**_VALID, **overrides}
    return await setup.setup_deployment(**arguments, search_indexer=MagicMock())


class TestSetupRequired:
    async def test_true_while_no_user_exists(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=_result(None))

        assert await setup_required(session) is True

    async def test_false_once_any_user_exists(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=_result(generate_id()))

        assert await setup_required(session) is False


class TestSetupDeployment:
    async def test_a_completed_setup_refuses_without_taking_the_lock(
        self, collaborators: Collaborators
    ) -> None:
        collaborators.session.execute.side_effect = [_result(generate_id())]

        with pytest.raises(SetupAlreadyCompletedError):
            await _run()

        collaborators.session.execute.assert_awaited_once()
        statement = collaborators.session.execute.await_args.args[0]
        assert _LOCK_FUNCTION not in str(statement.compile())
        collaborators.session.add.assert_not_called()
        collaborators.hash_password.assert_not_called()
        collaborators.session.commit.assert_not_awaited()

    async def test_a_user_created_while_waiting_for_the_lock_refuses_and_writes_nothing(
        self, collaborators: Collaborators
    ) -> None:
        collaborators.session.execute.side_effect = [
            _result(None),
            MagicMock(),
            _result(generate_id()),
        ]

        with pytest.raises(SetupAlreadyCompletedError):
            await _run()

        collaborators.session.add.assert_not_called()
        collaborators.organizations.stage_organization.assert_not_awaited()
        collaborators.audit.assert_not_awaited()
        collaborators.hash_password.assert_not_called()
        collaborators.session.commit.assert_not_awaited()
        collaborators.session.rollback.assert_awaited_once()

    async def test_takes_the_bootstrap_lock_before_the_locked_check_for_users(
        self, collaborators: Collaborators
    ) -> None:
        await _run()

        lock_statement = collaborators.session.execute.await_args_list[1].args[0]
        compiled = lock_statement.compile()
        assert _LOCK_FUNCTION in str(compiled)
        assert list(compiled.params.values()) == [BOOTSTRAP_LOCK_ID]
        assert collaborators.session.execute.await_count == 3

    async def test_creates_the_operator_as_a_verified_system_admin(
        self, collaborators: Collaborators
    ) -> None:
        await _run()

        user = collaborators.session.add.call_args_list[0].args[0]
        assert isinstance(user, User)
        assert user.email == _EMAIL
        assert user.username == _LOCAL_PART
        assert user.full_name == _LOCAL_PART
        assert user.is_system_admin is True
        assert user.is_active is True
        assert user.email_verified is True
        assert user.hashed_password == _HASHED
        collaborators.hash_password.assert_called_once_with(_VALID["password"])

    async def test_keeps_a_provided_full_name(self, collaborators: Collaborators) -> None:
        await _run(full_name=f"  {_FULL_NAME} ")

        user = collaborators.session.add.call_args_list[0].args[0]
        assert user.full_name == _FULL_NAME

    async def test_stages_the_organization_with_the_operator_as_bootstrap_owner(
        self, collaborators: Collaborators
    ) -> None:
        await _run()

        user = collaborators.session.add.call_args_list[0].args[0]
        collaborators.organizations.stage_organization.assert_awaited_once_with(
            name=_ORG_NAME,
            slug=_SLUG,
            owner_user_id=user.id,
            plan="enterprise",
            actor_user_id=user.id,
            owner_source=OrganizationMemberSource.BOOTSTRAP,
            begin_onboarding=True,
        )

    async def test_commits_the_audit_row_with_the_organization_then_finishes(
        self, collaborators: Collaborators
    ) -> None:
        order = MagicMock()
        collaborators.audit.side_effect = lambda *a, **k: order.audit()
        collaborators.session.commit.side_effect = lambda: order.commit()
        collaborators.organizations.finish_organization_create_after_commit.side_effect = (
            lambda *a, **k: order.finish()
        )

        await _run()

        assert [call[0] for call in order.mock_calls] == ["audit", "commit", "finish"]
        collaborators.session.commit.assert_awaited_once()
        user = collaborators.session.add.call_args_list[0].args[0]
        kwargs = collaborators.audit.await_args.kwargs
        assert kwargs["action"] == Action.DEPLOYMENT_SETUP_COMPLETED
        assert kwargs["organization_id"] == collaborators.organization.id
        assert kwargs["actor_user_id"] == user.id
        assert kwargs["resource_type"] == AuditResourceType.ORGANIZATION
        assert kwargs["resource_id"] == collaborators.organization.id
        assert kwargs["details"]["slug"] == _SLUG
        assert _EMAIL not in str(kwargs["details"])
        collaborators.organizations.finish_organization_create_after_commit.assert_awaited_once()
        assert (
            collaborators.organizations.finish_organization_create_after_commit.await_args.args[0]
            is collaborators.staged
        )

    async def test_returns_a_session_bound_to_the_new_organization(
        self, collaborators: Collaborators
    ) -> None:
        result = await _run()

        assert result is collaborators.auth_result
        assert result.organization_id == collaborators.organization.id
        user = collaborators.session.add.call_args_list[0].args[0]
        collaborators.auth.assert_awaited_once_with(
            collaborators.session, user, collaborators.organization, user_agent=_USER_AGENT
        )

    async def test_seeds_push_keys_inside_the_setup_transaction(
        self, collaborators: Collaborators
    ) -> None:
        await _run()

        collaborators.vapid.assert_awaited_once_with(collaborators.session, _EMAIL)

    async def test_uses_the_requested_slug(self, collaborators: Collaborators) -> None:
        await _run(organization_slug=f" {_SHORT_SLUG.upper()} ")

        kwargs = collaborators.organizations.stage_organization.await_args.kwargs
        assert kwargs["slug"] == _SHORT_SLUG

    async def test_failure_before_commit_rolls_back(self, collaborators: Collaborators) -> None:
        collaborators.organizations.stage_organization.side_effect = RuntimeError("boom")

        with pytest.raises(RuntimeError):
            await _run()

        collaborators.session.commit.assert_not_awaited()
        collaborators.session.rollback.assert_awaited_once()
        collaborators.organizations.finish_organization_create_after_commit.assert_not_awaited()

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"email": "not-an-email"}, "email"),
            ({"email": "   "}, "email"),
            ({"email": f"{'a' * 250}@example.com"}, "email"),
            ({"password": "short"}, "password"),
            ({"full_name": "x" * 256}, "full_name"),
            ({"organization_name": "   "}, "name"),
            ({"organization_slug": "Not A Slug!"}, "slug"),
            ({"organization_name": "!!!", "organization_slug": None}, "slug"),
        ],
        ids=[
            "email-no-at",
            "email-blank",
            "email-too-long",
            "weak-password",
            "full-name-too-long",
            "blank-org-name",
            "bad-slug",
            "underivable-slug",
        ],
    )
    async def test_validation_errors_raise_before_any_write(
        self,
        collaborators: Collaborators,
        overrides: dict[str, str | None],
        field: str,
    ) -> None:
        with pytest.raises(ValidationError) as exc_info:
            await _run(**overrides)

        assert exc_info.value.field == field
        collaborators.opened.assert_not_called()
        collaborators.hash_password.assert_not_called()


class TestSetupRateLimit:
    async def test_limits_per_client_ip(self, collaborators: Collaborators) -> None:
        collaborators.client_ip.return_value = "203.0.113.7"

        await _run()

        collaborators.rate_limit.assert_awaited_once_with(
            key="rl:auth:setup:ip:203.0.113.7",
            limit=setup.SETUP_LIMIT_PER_IP,
            window_seconds=setup.SETUP_WINDOW_SECONDS,
            resource="deployment setup attempts (per ip)",
        )
        assert setup.SETUP_LIMIT_PER_IP == 10
        assert setup.SETUP_WINDOW_SECONDS == 900

    async def test_skips_the_bucket_without_a_trusted_client_ip(
        self, collaborators: Collaborators
    ) -> None:
        await _run()

        collaborators.rate_limit.assert_not_awaited()

    async def test_exceeded_limit_stops_before_the_database(
        self, collaborators: Collaborators
    ) -> None:
        collaborators.client_ip.return_value = "203.0.113.7"
        collaborators.rate_limit.side_effect = RateLimitExceededError(
            resource="deployment setup attempts (per ip)",
            limit=10,
            window_seconds=900,
            retry_after=60,
        )

        with pytest.raises(RateLimitExceededError):
            await _run()

        collaborators.opened.assert_not_called()


def _request(**fields: str) -> SetupDeploymentRequest:
    return SetupDeploymentRequest(
        email=fields.get("email", _EMAIL),
        password=fields.get("password", "correct-horse-battery"),
        organization_name=fields.get("organization_name", "Acme"),
    )


def _ctx() -> MagicMock:
    ctx = MagicMock()
    ctx.request_headers = {"user-agent": "Mozilla/5.0"}
    return ctx


class TestSetupDeploymentHandler:
    async def test_returns_the_auth_result_with_the_asset_cookie(self) -> None:
        result = AuthResult(
            access_token=_ACCESS,
            refresh_token="refresh",
            user_id=generate_id(),
            organization_id=generate_id(),
            organization_slug=_SHORT_SLUG,
            organization_role="OWNER",
            session_id=generate_id(),
            domain_admin_domains=[],
        )
        run = AsyncMock(return_value=result)
        search_indexer = MagicMock()

        with (
            patch(f"{_HANDLERS}.setup_deployment", run),
            patch(f"{_HANDLERS}.attach_asset_cookie", MagicMock(return_value=_COOKIE)),
        ):
            response = await AuthHandlers(search_indexer, MagicMock()).setup_deployment(
                _request(), _ctx()
            )

        assert response.auth_result.access_token == _ACCESS
        assert response.auth_result.organization_slug == _SHORT_SLUG
        assert response.auth_result.organization_id == str(result.organization_id)
        assert response.auth_result.asset_cookie == _COOKIE
        kwargs = run.await_args.kwargs
        assert kwargs["full_name"] is None
        assert kwargs["organization_slug"] is None
        assert kwargs["user_agent"] == _USER_AGENT
        assert kwargs["search_indexer"] is search_indexer

    @pytest.mark.parametrize(
        ("error", "code"),
        [
            (ValidationError("slug", "bad"), Code.INVALID_ARGUMENT),
            (ValidationError("password", "weak"), Code.INVALID_ARGUMENT),
            (
                RateLimitExceededError(
                    resource="setup", limit=10, window_seconds=900, retry_after=60
                ),
                Code.RESOURCE_EXHAUSTED,
            ),
            (SetupAlreadyCompletedError("Setup is already complete"), Code.FAILED_PRECONDITION),
        ],
        ids=["slug", "password", "rate-limit", "completed"],
    )
    async def test_maps_domain_errors(self, error: Exception, code: Code) -> None:
        with (
            patch(f"{_HANDLERS}.setup_deployment", AsyncMock(side_effect=error)),
            pytest.raises(ConnectError) as exc_info,
        ):
            await AuthHandlers(MagicMock(), MagicMock()).setup_deployment(_request(), _ctx())

        assert exc_info.value.code is code

    async def test_completed_setup_keeps_its_typed_reason(self) -> None:
        with (
            patch(
                f"{_HANDLERS}.setup_deployment",
                AsyncMock(side_effect=SetupAlreadyCompletedError("Setup is already complete")),
            ),
            pytest.raises(ConnectError) as exc_info,
        ):
            await AuthHandlers(MagicMock(), MagicMock()).setup_deployment(_request(), _ctx())

        expected = error_info_detail(SETUP_COMPLETED_REASON)
        assert [
            (detail.type_name, detail.message_bytes)
            for detail in with_domain_details(exc_info.value).details
        ] == [(expected.type_name, expected.message_bytes)]

    async def test_unexpected_errors_hide_their_text(self) -> None:
        with (
            patch(
                f"{_HANDLERS}.setup_deployment",
                AsyncMock(side_effect=RuntimeError("connection string with password")),
            ),
            pytest.raises(ConnectError) as exc_info,
        ):
            await AuthHandlers(MagicMock(), MagicMock()).setup_deployment(_request(), _ctx())

        assert exc_info.value.code is Code.INTERNAL
        assert exc_info.value.message == _INTERNAL


class TestGetAuthConfig:
    @pytest.mark.parametrize("needs_setup", [True, False])
    async def test_reports_whether_setup_is_required(self, needs_setup: bool) -> None:
        session = MagicMock()

        @asynccontextmanager
        async def open_session() -> AsyncIterator[MagicMock]:
            yield session

        with (
            patch(f"{_HANDLERS}.open_session", open_session),
            patch(f"{_HANDLERS}.public_registration_enabled", AsyncMock(return_value=True)),
            patch(f"{_HANDLERS}.setup_required", AsyncMock(return_value=needs_setup)) as check,
        ):
            response = await AuthHandlers(MagicMock(), MagicMock()).get_auth_config(
                GetAuthConfigRequest(), _ctx()
            )

        assert response.public_registration_enabled is True
        assert response.setup_required is needs_setup
        check.assert_awaited_once_with(session)
