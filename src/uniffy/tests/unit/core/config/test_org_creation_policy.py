"""Organization creation policy: the deployment, environment and default tiers, then the ladder."""

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from loguru import logger
from sqlalchemy.dialects import postgresql

from uniffy.core.config import org_creation
from uniffy.core.config.org_creation import (
    DEFAULT_ORG_CREATION_POLICY,
    ORG_CREATION_KEY,
    OrgCreationPolicy,
    resolve_org_creation,
    user_can_create_organization,
)
from uniffy.core.config.source import SettingSource
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.types import generate_id

_SETTINGS = "uniffy.core.config.org_creation.DeploymentSettingsOperations"
_ENV = "ALLOW_ORG_CREATION"
_UNKNOWN_POLICY = "owners"
_ROLE_COLUMN = "login_organization_members.role"
_OWNER_ROLE_FILTER = f"{_ROLE_COLUMN} = "
_ACTIVE_MEMBER_FILTER = "login_organization_members.is_active IS true"
_LIVE_ORG_FILTER = "login_organizations.deleted_at IS NULL"
_UNSUSPENDED_ORG_FILTER = "login_organizations.is_suspended IS false"
_SINGLE_ROW = "LIMIT"
_JOINED_ORG = "JOIN login_organizations ON"
_ACTIVE_ACCOUNT_FILTER = "login_users.is_active IS true"


def _settings(row_value: object | None = None, *, is_secret: bool = False) -> MagicMock:
    rows = {}
    if row_value is not None:
        rows[ORG_CREATION_KEY] = DeploymentSetting(
            namespace="system", key=ORG_CREATION_KEY, value=row_value, is_secret=is_secret
        )
    settings = MagicMock()
    settings.get_namespace = AsyncMock(return_value=rows)
    return settings


def _user(*, is_active: bool = True, is_system_admin: bool = False) -> User:
    return User(
        id=generate_id(),
        email="person@example.com",
        username="person",
        is_active=is_active,
        is_system_admin=is_system_admin,
    )


def _membership_session(*, holds_membership: bool) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = generate_id() if holds_membership else None
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


def _compiled(session: MagicMock) -> str:
    (statement,) = session.execute.await_args.args
    return str(statement.compile(dialect=postgresql.dialect()))


@pytest.fixture
def logged_warnings() -> Iterator[list[str]]:
    org_creation._warned_values.clear()
    messages: list[str] = []
    sink = logger.add(
        lambda message: messages.append(str(message)), level="WARNING", format="{message} {extra}"
    )
    try:
        yield messages
    finally:
        logger.remove(sink)


class TestResolveOrgCreation:
    async def test_deployment_row_beats_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(_ENV, "members")
        with patch(_SETTINGS, return_value=_settings("anyone")):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is OrgCreationPolicy.ANYONE
        assert state.source is SettingSource.DEPLOYMENT

    async def test_env_beats_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(_ENV, "operators_only")
        with patch(_SETTINGS, return_value=_settings()):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is OrgCreationPolicy.OPERATORS_ONLY
        assert state.source is SettingSource.ENV

    async def test_default_when_neither_tier_is_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(_ENV, raising=False)
        with patch(_SETTINGS, return_value=_settings()):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is DEFAULT_ORG_CREATION_POLICY
        assert state.policy is OrgCreationPolicy.OPERATORS_AND_OWNERS
        assert state.source is SettingSource.DEFAULT

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("MEMBERS", OrgCreationPolicy.MEMBERS),
            ("  Anyone \n", OrgCreationPolicy.ANYONE),
            ("operators_and_owners", OrgCreationPolicy.OPERATORS_AND_OWNERS),
        ],
    )
    async def test_names_parse_case_insensitively_with_whitespace(
        self, raw: str, expected: OrgCreationPolicy, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(_ENV, raw)
        with patch(_SETTINGS, return_value=_settings()):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is expected
        assert state.source is SettingSource.ENV

    @pytest.mark.parametrize("row_value", ["everyone", True, {"policy": "anyone"}])
    async def test_bad_row_value_falls_through_to_env(
        self, row_value: object, monkeypatch: pytest.MonkeyPatch, logged_warnings: list[str]
    ) -> None:
        monkeypatch.setenv(_ENV, "members")
        with patch(_SETTINGS, return_value=_settings(row_value)):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is OrgCreationPolicy.MEMBERS
        assert state.source is SettingSource.ENV
        assert len(logged_warnings) == 1
        assert repr(row_value) in logged_warnings[0]

    async def test_bad_env_value_falls_through_to_default(
        self, monkeypatch: pytest.MonkeyPatch, logged_warnings: list[str]
    ) -> None:
        monkeypatch.setenv(_ENV, _UNKNOWN_POLICY)
        with patch(_SETTINGS, return_value=_settings()):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is DEFAULT_ORG_CREATION_POLICY
        assert state.source is SettingSource.DEFAULT
        assert len(logged_warnings) == 1
        assert repr(_UNKNOWN_POLICY) in logged_warnings[0]

    async def test_a_bad_value_warns_once_per_process(
        self, monkeypatch: pytest.MonkeyPatch, logged_warnings: list[str]
    ) -> None:
        monkeypatch.setenv(_ENV, _UNKNOWN_POLICY)
        with patch(_SETTINGS, return_value=_settings()):
            for _ in range(3):
                state = await resolve_org_creation(MagicMock())

        assert state.policy is DEFAULT_ORG_CREATION_POLICY
        assert len(logged_warnings) == 1

    async def test_blank_env_counts_as_unset_without_a_warning(
        self, monkeypatch: pytest.MonkeyPatch, logged_warnings: list[str]
    ) -> None:
        monkeypatch.setenv(_ENV, "   ")
        with patch(_SETTINGS, return_value=_settings()):
            state = await resolve_org_creation(MagicMock())

        assert state.source is SettingSource.DEFAULT
        assert logged_warnings == []

    async def test_secret_row_is_ignored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(_ENV, "members")
        with patch(_SETTINGS, return_value=_settings("anyone", is_secret=True)):
            state = await resolve_org_creation(MagicMock())

        assert state.policy is OrgCreationPolicy.MEMBERS
        assert state.source is SettingSource.ENV


class TestUserCanCreateOrganization:
    @pytest.mark.parametrize(
        ("policy", "holds_membership", "expected"),
        [
            (OrgCreationPolicy.OPERATORS_ONLY, True, False),
            (OrgCreationPolicy.OPERATORS_ONLY, False, False),
            (OrgCreationPolicy.OPERATORS_AND_OWNERS, True, True),
            (OrgCreationPolicy.OPERATORS_AND_OWNERS, False, False),
            (OrgCreationPolicy.MEMBERS, True, True),
            (OrgCreationPolicy.MEMBERS, False, False),
            (OrgCreationPolicy.ANYONE, True, True),
            (OrgCreationPolicy.ANYONE, False, True),
        ],
    )
    async def test_each_rung_of_the_ladder(
        self,
        policy: OrgCreationPolicy,
        holds_membership: bool,
        expected: bool,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv(_ENV, policy.value)
        session = _membership_session(holds_membership=holds_membership)
        with patch(_SETTINGS, return_value=_settings()):
            allowed = await user_can_create_organization(session, _user())

        assert allowed is expected

    async def test_owner_rung_asks_for_an_owner_membership(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(_ENV, OrgCreationPolicy.OPERATORS_AND_OWNERS.value)
        session = _membership_session(holds_membership=True)
        with patch(_SETTINGS, return_value=_settings()):
            await user_can_create_organization(session, _user())

        sql = _compiled(session)
        session.execute.assert_awaited_once()
        assert _OWNER_ROLE_FILTER in sql
        assert _ACTIVE_MEMBER_FILTER in sql
        assert _LIVE_ORG_FILTER in sql
        assert _UNSUSPENDED_ORG_FILTER in sql
        assert _ACTIVE_ACCOUNT_FILTER in sql
        assert _JOINED_ORG in sql
        assert _SINGLE_ROW in sql

    async def test_members_rung_accepts_any_role(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(_ENV, OrgCreationPolicy.MEMBERS.value)
        session = _membership_session(holds_membership=True)
        with patch(_SETTINGS, return_value=_settings()):
            await user_can_create_organization(session, _user())

        sql = _compiled(session)
        assert _ROLE_COLUMN not in sql
        assert _LIVE_ORG_FILTER in sql

    @pytest.mark.parametrize("policy", list(OrgCreationPolicy))
    async def test_operator_may_always_create(
        self, policy: OrgCreationPolicy, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(_ENV, policy.value)
        session = _membership_session(holds_membership=False)
        with patch(_SETTINGS, return_value=_settings()):
            allowed = await user_can_create_organization(session, _user(is_system_admin=True))

        assert allowed is True
        session.execute.assert_not_awaited()

    async def test_inactive_user_is_refused_even_under_anyone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(_ENV, OrgCreationPolicy.ANYONE.value)
        with patch(_SETTINGS, return_value=_settings()):
            allowed = await user_can_create_organization(
                _membership_session(holds_membership=True),
                _user(is_active=False, is_system_admin=True),
            )

        assert allowed is False
