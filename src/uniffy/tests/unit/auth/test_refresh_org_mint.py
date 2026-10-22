"""A refresh mints an access token for the requested organization and keeps the session."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from prometheus_client import REGISTRY

from uniffy.core.audit.actions import Action
from uniffy.core.auth.tokens import (
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import generate_id
from uniffy.domains.auth.contracts import hash_refresh_token
from uniffy.domains.auth.errors import AuthenticationError
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.types import AuthResult

_OPS = "uniffy.domains.auth.operations"
_ACME = "acme"
_GLOBEX = "globex"
_ACME_RENAMED = "acme-industries"
_ORG_SWITCH = "org_switch"
_ORG_DROPPED = "org_dropped"
_NOT_A_MEMBER = "User is not a member of this organization"
_STORED_REFRESH = "stored-refresh"
_ORG_CLAIM = "org_id"

Membership = tuple[UUID, str, str, list[str]]


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    # The unit tier reads nothing from .env; the tokens minted here need a signing key.
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")


def _scalar(value: object) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _switch_count() -> float:
    labels = {"operation": "refresh", "outcome": "switch"}
    return REGISTRY.get_sample_value("uniffy_auth_attempts_total", labels) or 0.0


class _Refresher:
    """One user, one real session row, and the memberships the patched gate accepts."""

    def __init__(self) -> None:
        self.user = User(
            id=generate_id(),
            email="alice@example.com",
            username="alice",
            full_name="Alice",
            is_active=True,
            token_version=0,
        )
        self.row = UserSession(user_id=self.user.id)
        self.refresh_token = create_refresh_token(
            self.user.id, token_version=0, session_id=self.row.id
        )
        self.row.refresh_token_hash = hash_refresh_token(self.refresh_token)
        self.db = MagicMock()
        self.db.commit = AsyncMock()
        self.call_lifecycle = AsyncMock()
        self.audit = AsyncMock()
        self.mark_revoked = AsyncMock()
        self.publish_revoke = AsyncMock()
        self.by_slug = AsyncMock(side_effect=self._by_slug)
        self.by_id = AsyncMock(side_effect=self._by_id)
        self._memberships: dict[str, Membership] = {}

    def join(self, slug: str) -> UUID:
        org_id = generate_id()
        self._memberships[slug] = (org_id, slug, OrganizationRole.MEMBER.value, [])
        return org_id

    def rename(self, slug: str, new_slug: str) -> None:
        org_id, _, role, domain_admins = self._memberships.pop(slug)
        self._memberships[new_slug] = (org_id, new_slug, role, domain_admins)

    async def _by_slug(self, _user_id: UUID, slug: str) -> Membership:
        if slug not in self._memberships:
            raise AuthenticationError(_NOT_A_MEMBER)
        return self._memberships[slug]

    async def _by_id(self, _user_id: UUID, org_id: UUID) -> Membership:
        for membership in self._memberships.values():
            if membership[0] == org_id:
                return membership
        raise AuthenticationError(_NOT_A_MEMBER)

    async def refresh(self, slug: str | None = None, org_id: UUID | None = None) -> AuthResult:
        with (
            patch.object(AuthOperations, "_get_user_by_id", AsyncMock(return_value=self.user)),
            patch.object(
                AuthOperations, "_validate_and_touch_session", AsyncMock(return_value=self.row)
            ),
            patch.object(AuthOperations, "_verify_org_membership", self.by_slug),
            patch.object(AuthOperations, "_verify_org_membership_by_id", self.by_id),
            patch(f"{_OPS}.write_audit_event", self.audit),
            patch(f"{_OPS}.mark_session_revoked", self.mark_revoked),
            patch(f"{_OPS}._publish_session_revoke_safe", self.publish_revoke),
        ):
            result = await AuthOperations(self.db, self.call_lifecycle).refresh_token(
                self.refresh_token, organization_slug=slug, organization_id=org_id
            )
        self.refresh_token = result.refresh_token
        return result

    def last_audit(self) -> dict[str, Any]:
        self.audit.assert_awaited()
        return self.audit.await_args.kwargs


async def test_slug_for_another_org_mints_that_org_and_records_the_switch() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    globex_id = refresher.join(_GLOBEX)
    refresher.row.organization_id = acme_id
    switches_before = _switch_count()

    result = await refresher.refresh(slug=_GLOBEX)

    assert decode_access_token(result.access_token)["org_id"] == str(globex_id)
    assert result.organization_id == globex_id
    assert result.organization_slug == _GLOBEX
    assert refresher.row.organization_id == globex_id
    audit = refresher.last_audit()
    assert audit["action"] == Action.AUTH_TOKEN_REFRESHED
    assert audit["organization_id"] == globex_id
    assert audit["details"] == {
        "event": _ORG_SWITCH,
        "previous_org_id": str(acme_id),
        "target_org_id": str(globex_id),
        "session_id": str(refresher.row.id),
    }
    assert audit["dedupe_key"] is None
    assert _switch_count() == switches_before + 1
    refresher.db.commit.assert_awaited_once()


async def test_slug_for_the_session_org_is_a_plain_deduped_refresh() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id
    switches_before = _switch_count()

    result = await refresher.refresh(slug=_ACME)

    assert result.organization_id == acme_id
    audit = refresher.last_audit()
    assert audit["details"] == {"session_id": str(refresher.row.id)}
    assert audit["dedupe_key"] == str(refresher.user.id)
    assert _switch_count() == switches_before


async def test_first_slug_on_an_org_less_session_binds_it_without_a_switch_event() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)

    result = await refresher.refresh(slug=_ACME)

    assert result.organization_id == acme_id
    assert refresher.row.organization_id == acme_id
    assert refresher.last_audit()["dedupe_key"] == str(refresher.user.id)


async def test_no_slug_mints_the_session_org() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id

    result = await refresher.refresh()

    assert decode_access_token(result.access_token)["org_id"] == str(acme_id)
    assert result.organization_slug == _ACME
    refresher.by_id.assert_awaited_once_with(refresher.user.id, acme_id)
    refresher.by_slug.assert_not_awaited()
    audit = refresher.last_audit()
    assert audit["details"] == {"session_id": str(refresher.row.id)}
    assert audit["dedupe_key"] == str(refresher.user.id)


async def test_no_slug_and_no_session_org_mints_an_org_less_token() -> None:
    refresher = _Refresher()
    refresher.join(_ACME)

    result = await refresher.refresh()

    assert _ORG_CLAIM not in decode_access_token(result.access_token)
    assert result.organization_id is None
    assert result.organization_slug is None
    assert refresher.row.organization_id is None
    refresher.by_slug.assert_not_awaited()
    refresher.by_id.assert_not_awaited()
    assert refresher.last_audit()["organization_id"] is None


async def test_a_switch_keeps_the_session_and_its_calls() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    globex_id = refresher.join(_GLOBEX)
    refresher.row.organization_id = acme_id

    into_globex = await refresher.refresh(slug=_GLOBEX)
    back_to_acme = await refresher.refresh(slug=_ACME)

    assert into_globex.organization_id == globex_id
    assert back_to_acme.organization_id == acme_id
    assert into_globex.session_id == back_to_acme.session_id == refresher.row.id
    assert decode_refresh_token(back_to_acme.refresh_token)["sid"] == str(refresher.row.id)
    assert refresher.row.is_revoked is False
    assert refresher.row.revoked_at is None
    assert refresher.row.refresh_token_hash == hash_refresh_token(back_to_acme.refresh_token)
    refresher.call_lifecycle.evict_user.assert_not_awaited()
    refresher.mark_revoked.assert_not_awaited()
    refresher.publish_revoke.assert_not_awaited()
    events = [c.kwargs["details"]["event"] for c in refresher.audit.await_args_list]
    assert events == [_ORG_SWITCH, _ORG_SWITCH]


async def test_a_lost_grant_demotes_the_session_to_no_org_and_keeps_it_alive() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id

    result = await refresher.refresh(_GLOBEX)

    assert _ORG_CLAIM not in decode_access_token(result.access_token)
    assert result.organization_id is None
    assert result.organization_slug is None
    assert refresher.row.organization_id is None
    assert refresher.row.is_revoked is False
    assert refresher.row.previous_refresh_rotated_at is not None
    audit = refresher.last_audit()
    assert audit["details"]["event"] == _ORG_DROPPED
    assert audit["details"]["requested_slug"] == _GLOBEX
    assert audit["details"]["previous_org_id"] == str(acme_id)
    assert audit["details"]["reason"] == _NOT_A_MEMBER
    assert audit["dedupe_key"] is None
    refresher.db.commit.assert_awaited_once()
    refresher.publish_revoke.assert_not_awaited()


async def test_a_lost_last_org_without_a_slug_demotes_the_session() -> None:
    refresher = _Refresher()
    refresher.join(_ACME)
    refresher.row.organization_id = generate_id()

    result = await refresher.refresh()

    assert result.organization_id is None
    assert refresher.row.organization_id is None
    audit = refresher.last_audit()
    assert audit["details"]["event"] == _ORG_DROPPED
    assert audit["details"]["requested_slug"] is None
    assert decode_refresh_token(result.refresh_token)["sid"] == str(refresher.row.id)


async def test_a_renamed_slug_keeps_the_grant_when_the_client_refreshes_by_id() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id
    refresher.rename(_ACME, _ACME_RENAMED)

    result = await refresher.refresh(slug=_ACME, org_id=acme_id)

    assert decode_access_token(result.access_token)[_ORG_CLAIM] == str(acme_id)
    assert result.organization_id == acme_id
    assert result.organization_slug == _ACME_RENAMED
    assert refresher.row.organization_id == acme_id
    refresher.by_id.assert_awaited_once_with(refresher.user.id, acme_id)
    refresher.by_slug.assert_not_awaited()
    assert refresher.last_audit()["details"] == {"session_id": str(refresher.row.id)}


async def test_the_stale_slug_alone_loses_the_grant_after_a_rename() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id
    refresher.rename(_ACME, _ACME_RENAMED)

    result = await refresher.refresh(slug=_ACME)

    assert result.organization_id is None
    assert refresher.last_audit()["details"]["event"] == _ORG_DROPPED


async def test_the_id_wins_over_a_slug_for_another_org() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.join(_GLOBEX)
    refresher.row.organization_id = acme_id

    result = await refresher.refresh(slug=_GLOBEX, org_id=acme_id)

    assert result.organization_id == acme_id
    assert result.organization_slug == _ACME
    refresher.by_slug.assert_not_awaited()


async def test_an_id_without_a_membership_demotes_the_session_and_records_the_id() -> None:
    refresher = _Refresher()
    acme_id = refresher.join(_ACME)
    refresher.row.organization_id = acme_id
    foreign_id = generate_id()

    result = await refresher.refresh(org_id=foreign_id)

    assert result.organization_id is None
    assert refresher.row.organization_id is None
    assert refresher.row.is_revoked is False
    details = refresher.last_audit()["details"]
    assert details["event"] == _ORG_DROPPED
    assert details["requested_org_id"] == str(foreign_id)
    assert details["requested_slug"] is None
