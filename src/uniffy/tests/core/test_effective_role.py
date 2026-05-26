"""Tests for PermissionChecker.effective_role().

The effective_role function is the single choke-point for all access
decisions. Every branch is tested here. Private methods (_is_org_admin,
_is_domain_admin_for_content, _get_member_role, _is_user_in_organization)
are patched so these tests exercise the branching logic only, not the DB
layer (that is tested in test_member_lookup.py).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.core.types import generate_id as uuid7


@pytest.fixture(autouse=True)
def _no_support_session():
    """Skip both support-session entry points so these tests exercise the
    pure branching logic. ``_ensure_support_session_context`` now runs
    unconditionally at the top of ``effective_role`` (so the ContextVar
    is populated regardless of role-cache state); ``_support_session_role``
    still drives the role decision inside ``_compute``. Both go through
    the MagicMock session otherwise."""
    with (
        patch.object(
            PermissionChecker, "_support_session_role", AsyncMock(return_value=None)
        ),
        patch.object(
            PermissionChecker,
            "_ensure_support_session_context",
            AsyncMock(return_value=None),
        ),
    ):
        yield


def _make_checker() -> PermissionChecker:
    return PermissionChecker(MagicMock())


def _run(coro):
    return asyncio.run(coro)


def _call(
    checker,
    owner_id=None,
    access_mode=AccessMode.EXPLICIT_MEMBERS,
    baseline_role=None,
    user_id=None,
    org_id=None,
    content_id=None,
):
    return _run(
        checker.effective_role(
            user_id=user_id or uuid7(),
            organization_id=org_id or uuid7(),
            content_type=ContentType.NOTE,
            content_id=content_id or uuid7(),
            owner_id=owner_id or uuid7(),
            access_mode=access_mode,
            baseline_role=baseline_role,
        )
    )


class TestOrgAdminBypass:
    """Org ADMIN/OWNER always gets OWNER regardless of content state."""

    def test_org_admin_returns_owner(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
        ):
            role = _call(checker)
        assert role == ContentRole.OWNER

    def test_org_admin_bypasses_blocked_member_row(self) -> None:
        """Org admins are unaffected by BLOCKED rows on the content."""
        user_id = uuid7()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
        ):
            role = _call(checker, user_id=user_id)
        assert role == ContentRole.OWNER

    def test_org_admin_bypasses_owner_only_mode(self) -> None:
        checker = _make_checker()
        with patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)):
            role = _call(checker, access_mode=AccessMode.OWNER_ONLY)
        assert role == ContentRole.OWNER


class TestDomainAdminBypass:
    """Domain admins get ADMIN (not OWNER) on their domain's content."""

    def test_domain_admin_returns_admin(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=True)),
        ):
            role = _call(checker)
        assert role == ContentRole.ADMIN

    def test_domain_admin_not_triggered_when_org_admin(self) -> None:
        """Org admin short-circuits before domain admin check."""
        checker = _make_checker()
        domain_admin_mock = AsyncMock(return_value=True)
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_is_domain_admin_for_content", domain_admin_mock),
        ):
            role = _call(checker)
        assert role == ContentRole.OWNER
        domain_admin_mock.assert_not_called()


class TestOwnerCheck:
    """Content owner always gets OWNER regardless of member rows."""

    def test_owner_returns_owner_role(self) -> None:
        user_id = uuid7()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = _call(checker, owner_id=user_id, user_id=user_id)
        assert role == ContentRole.OWNER

    def test_non_owner_does_not_get_owner_from_id_check(self) -> None:
        user_id = uuid7()
        other_owner = uuid7()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = _call(
                checker, owner_id=other_owner, user_id=user_id, access_mode=AccessMode.OWNER_ONLY
            )
        assert role is None


class TestExplicitMemberRole:
    """Direct or group-derived ContentMember rows override the baseline."""

    @pytest.mark.parametrize(
        "member_role",
        [
            ContentRole.ADMIN,
            ContentRole.EDITOR,
            ContentRole.COMMENTER,
            ContentRole.VIEWER,
        ],
    )
    def test_non_blocked_member_role_returned_directly(self, member_role: ContentRole) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=member_role)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == member_role

    def test_blocked_member_returns_none(self) -> None:
        """BLOCKED is an explicit deny - resolves to None (no access)."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role is None

    def test_explicit_role_beats_open_to_org_baseline(self) -> None:
        """EDITOR member + VIEWER baseline = EDITOR."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.EDITOR)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == ContentRole.EDITOR


class TestAccessModeBaseline:
    """Baseline access from access_mode when no explicit member row exists."""

    def test_owner_only_denies_non_owner(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = _call(checker, access_mode=AccessMode.OWNER_ONLY)
        assert role is None

    def test_explicit_members_denies_non_member(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = _call(checker, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is None

    def test_open_to_org_grants_baseline_to_org_member(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == ContentRole.VIEWER

    def test_open_to_org_denies_user_not_in_org(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=False)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role is None

    def test_open_to_org_null_baseline_inherits_org_default(self) -> None:
        """A null baseline_role on OPEN_TO_ORG content inherits live from the
        org default; with no org default the policy floors to VIEWER."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
            patch.object(
                checker,
                "get_org_defaults",
                AsyncMock(return_value=(AccessMode.OPEN_TO_ORG, ContentRole.EDITOR)),
            ),
        ):
            role = _call(checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=None)
        assert role == ContentRole.EDITOR

    def test_open_to_org_null_baseline_falls_back_to_viewer_floor(self) -> None:
        """When neither the row nor the org default supplies a baseline, the
        policy resolver floors to VIEWER rather than denying."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
            patch.object(checker, "get_org_defaults", AsyncMock(return_value=(None, None))),
        ):
            role = _call(checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=None)
        assert role == ContentRole.VIEWER

    def test_open_to_org_blocked_user_denied_despite_baseline(self) -> None:
        """BLOCKED overrides the OPEN_TO_ORG baseline for that specific user."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role is None

    def test_open_to_org_editor_baseline_granted(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role == ContentRole.EDITOR
