"""A bootstrap session binds its tokens to a membership the caller just created."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.auth.tokens import decode_access_token, decode_refresh_token
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import DomainType, generate_id
from uniffy.domains.auth.contracts import hash_refresh_token, stage_bootstrap_authentication
from uniffy.domains.auth.errors import AuthenticationError

_SLUG = "acme"


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")


def _user() -> User:
    return User(
        id=generate_id(),
        email="ops@example.com",
        username="ops",
        full_name="Ops",
        is_active=True,
        is_system_admin=True,
        token_version=3,
    )


def _organization() -> Organization:
    return Organization(id=generate_id(), name="Acme", slug=_SLUG, plan="enterprise", settings={})


def _session(membership: OrganizationMember | None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = membership
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    return session


async def test_mints_tokens_for_the_organization_and_leaves_the_commit_to_the_caller() -> None:
    user = _user()
    organization = _organization()
    membership = OrganizationMember(
        user_id=user.id,
        organization_id=organization.id,
        role=OrganizationRole.OWNER,
        is_active=True,
    )
    session = _session(membership)

    with patch(
        "uniffy.domains.auth.contracts.get_user_domain_admins",
        AsyncMock(return_value=[DomainType.NOTES]),
    ):
        result = await stage_bootstrap_authentication(
            session, user, organization, user_agent="Mozilla/5.0"
        )

    assert result.user_id == user.id
    assert result.organization_id == organization.id
    assert result.organization_slug == _SLUG
    assert result.organization_role == OrganizationRole.OWNER.value
    assert result.domain_admin_domains == [DomainType.NOTES.value]

    staged = session.add.call_args.args[0]
    assert isinstance(staged, UserSession)
    assert staged.id == result.session_id
    assert staged.organization_id == organization.id
    assert staged.refresh_token_hash == hash_refresh_token(result.refresh_token)

    access = decode_access_token(result.access_token)
    assert access["org_id"] == str(organization.id)
    assert access["sid"] == str(result.session_id)
    assert access["tkv"] == 3
    assert decode_refresh_token(result.refresh_token)["sid"] == str(result.session_id)
    session.commit.assert_not_awaited()


async def test_refuses_a_user_without_an_active_membership() -> None:
    session = _session(None)

    with pytest.raises(AuthenticationError):
        await stage_bootstrap_authentication(session, _user(), _organization(), user_agent="")

    session.add.assert_not_called()
