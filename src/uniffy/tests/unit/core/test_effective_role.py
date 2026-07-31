"""Tests for PermissionChecker.effective_role().

The effective_role function is the single choke-point for all access
decisions. Every branch is tested here. Private methods (_is_org_admin,
_is_domain_admin_for_content, _get_member_role, _is_user_in_organization)
are patched so these tests exercise the branching logic only, not the DB
layer (that is tested in test_member_lookup.py).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id


@pytest.fixture(autouse=True)
def _no_support_session():
    """Pin the sysadmin/support-session entry points off and default the
    actor to an active org member, so each test exercises one tenant branch.

    ``_ensure_support_session_context`` and ``_support_session_role`` both
    run inside ``effective_role`` and would otherwise hit the MagicMock
    session. Membership-gate tests override ``_is_user_in_organization``
    (and ``_is_system_admin``) per checker instance, which shadows these
    class-level patches.
    """
    with (
        patch.object(
            PermissionChecker, "_support_session_role", AsyncMock(return_value=None)
        ),
        patch.object(
            PermissionChecker,
            "_ensure_support_session_context",
            AsyncMock(return_value=None),
        ),
        patch.object(
            PermissionChecker, "_is_system_admin", AsyncMock(return_value=False)
        ),
        patch.object(
            PermissionChecker,
            "_is_user_in_organization",
            AsyncMock(return_value=True),
        ),
    ):
        yield


def _make_checker() -> PermissionChecker:
    return PermissionChecker(MagicMock())


async def _call(
    checker,
    owner_id=None,
    access_mode=AccessMode.EXPLICIT_MEMBERS,
    baseline_role=None,
    user_id=None,
    org_id=None,
    content_id=None,
):
    return await checker.effective_role(
        user_id=user_id or generate_id(),
        organization_id=org_id or generate_id(),
        content_type=ContentType.NOTE,
        content_id=content_id or generate_id(),
        owner_id=owner_id or generate_id(),
        access_mode=access_mode,
        baseline_role=baseline_role,
    )


class TestNoAdminBypass:
    """Org and domain admins get NO content bypass. Access flows only from
    ownership, an explicit ContentMember grant, or the OPEN_TO_ORG baseline -
    personal content is private until shared."""

    async def test_org_admin_denied_owner_only_when_not_owner(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(
                checker, owner_id=generate_id(), user_id=generate_id(),
                access_mode=AccessMode.OWNER_ONLY,
            )
        assert role is None

    async def test_org_admin_still_owns_their_own_content(self) -> None:
        user_id = generate_id()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(
                checker, owner_id=user_id, user_id=user_id,
                access_mode=AccessMode.OWNER_ONLY,
            )
        assert role == ContentRole.OWNER

    async def test_org_admin_gets_only_their_granted_role(self) -> None:
        """An org admin with an explicit VIEWER grant gets VIEWER, not OWNER."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.VIEWER)),
        ):
            role = await _call(checker, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role == ContentRole.VIEWER

    async def test_org_admin_blocked_row_denies(self) -> None:
        """BLOCKED applies to admins too - they are regular members for content."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role is None

    async def test_domain_admin_denied_owner_only_when_not_owner(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=True)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(
                checker, owner_id=generate_id(), user_id=generate_id(),
                access_mode=AccessMode.OWNER_ONLY,
            )
        assert role is None


class TestMembershipGate:
    """Active org membership precedes every tenant branch - ownership and
    explicit ContentMember grants confer nothing without it."""

    async def test_non_member_with_explicit_grant_denied(self) -> None:
        checker = _make_checker()
        with (
            patch.object(
                checker, "_is_user_in_organization", AsyncMock(return_value=False)
            ),
            patch.object(
                checker, "_get_member_role", AsyncMock(return_value=ContentRole.EDITOR)
            ),
        ):
            role = await _call(checker, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is None

    async def test_non_member_owner_denied(self) -> None:
        user_id = generate_id()
        checker = _make_checker()
        with patch.object(
            checker, "_is_user_in_organization", AsyncMock(return_value=False)
        ):
            role = await _call(
                checker, owner_id=user_id, user_id=user_id,
                access_mode=AccessMode.OWNER_ONLY,
            )
        assert role is None

    async def test_system_admin_non_member_reaches_support_session_path(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_system_admin", AsyncMock(return_value=True)),
            patch.object(
                checker, "_is_user_in_organization", AsyncMock(return_value=False)
            ),
            patch.object(
                checker,
                "_support_session_role",
                AsyncMock(return_value=ContentRole.VIEWER),
            ),
        ):
            role = await _call(checker, access_mode=AccessMode.OWNER_ONLY)
        assert role == ContentRole.VIEWER

    async def test_system_admin_non_member_without_session_denied(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_system_admin", AsyncMock(return_value=True)),
            patch.object(
                checker, "_is_user_in_organization", AsyncMock(return_value=False)
            ),
            patch.object(
                checker, "_support_session_role", AsyncMock(return_value=None)
            ),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG,
                baseline_role=ContentRole.VIEWER,
            )
        assert role is None


class TestOwnerCheck:
    """Content owner always gets OWNER regardless of member rows."""

    async def test_owner_returns_owner_role(self) -> None:
        user_id = generate_id()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(checker, owner_id=user_id, user_id=user_id)
        assert role == ContentRole.OWNER

    async def test_non_owner_does_not_get_owner_from_id_check(self) -> None:
        user_id = generate_id()
        other_owner = generate_id()
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(
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
    async def test_non_blocked_member_role_returned_directly(self, member_role: ContentRole) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=member_role)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == member_role

    async def test_blocked_member_returns_none(self) -> None:
        """BLOCKED is an explicit deny - resolves to None (no access)."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role is None

    async def test_explicit_role_beats_open_to_org_baseline(self) -> None:
        """EDITOR member + VIEWER baseline = EDITOR."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.EDITOR)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == ContentRole.EDITOR


class TestAccessModeBaseline:
    """Baseline access from access_mode when no explicit member row exists."""

    async def test_owner_only_denies_non_owner(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(checker, access_mode=AccessMode.OWNER_ONLY)
        assert role is None

    async def test_explicit_members_denies_non_member(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
        ):
            role = await _call(checker, access_mode=AccessMode.EXPLICIT_MEMBERS)
        assert role is None

    async def test_open_to_org_grants_baseline_to_org_member(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role == ContentRole.VIEWER

    async def test_open_to_org_denies_user_not_in_org(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=False)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
            )
        assert role is None

    async def test_open_to_org_null_baseline_inherits_org_default(self) -> None:
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
            role = await _call(checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=None)
        assert role == ContentRole.EDITOR

    async def test_open_to_org_null_baseline_falls_back_to_viewer_floor(self) -> None:
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
            role = await _call(checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=None)
        assert role == ContentRole.VIEWER

    async def test_open_to_org_blocked_user_denied_despite_baseline(self) -> None:
        """BLOCKED overrides the OPEN_TO_ORG baseline for that specific user."""
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=ContentRole.BLOCKED)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role is None

    async def test_open_to_org_editor_baseline_granted(self) -> None:
        checker = _make_checker()
        with (
            patch.object(checker, "_is_org_admin", AsyncMock(return_value=False)),
            patch.object(checker, "_is_domain_admin_for_content", AsyncMock(return_value=False)),
            patch.object(checker, "_get_member_role", AsyncMock(return_value=None)),
            patch.object(checker, "_is_user_in_organization", AsyncMock(return_value=True)),
        ):
            role = await _call(
                checker, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.EDITOR
            )
        assert role == ContentRole.EDITOR
