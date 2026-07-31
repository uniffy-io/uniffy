"""Tests for PermissionChecker._get_member_role().

This is the inner loop of the permission check: given (org, content_type,
content_id, user_id), return the highest applicable role from direct user
grants and group-derived grants, with BLOCKED-wins semantics.

The database session is mocked. The first session.execute() call returns
the direct user grant; the second returns the group grants.
"""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.types import ContentRole, ContentType, generate_id


def _make_result(scalar_value=None, all_rows=None):
    """Build a mock SQLAlchemy result object."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar_value
    result.all.return_value = all_rows or []
    return result


async def _run_lookup(direct_role, group_roles):
    """Execute _get_member_role with the given stubbed DB results."""
    org_id = generate_id()
    content_id = generate_id()
    user_id = generate_id()

    direct_result = _make_result(scalar_value=direct_role)
    group_result = _make_result(all_rows=[(r,) for r in group_roles])

    session = MagicMock()
    session.execute = AsyncMock(side_effect=[direct_result, group_result])

    checker = PermissionChecker(session)
    return await checker._get_member_role(org_id, ContentType.NOTE, content_id, user_id)


class TestDirectUserGrant:
    async def test_no_grant_returns_none(self) -> None:
        role = await _run_lookup(direct_role=None, group_roles=[])
        assert role is None

    async def test_direct_viewer_returned(self) -> None:
        role = await _run_lookup(direct_role=ContentRole.VIEWER, group_roles=[])
        assert role == ContentRole.VIEWER

    async def test_direct_editor_returned(self) -> None:
        role = await _run_lookup(direct_role=ContentRole.EDITOR, group_roles=[])
        assert role == ContentRole.EDITOR

    async def test_direct_blocked_returns_blocked_immediately(self) -> None:
        """Direct BLOCKED short-circuits before the group query fires."""
        role = await _run_lookup(direct_role=ContentRole.BLOCKED, group_roles=[])
        assert role == ContentRole.BLOCKED

    async def test_direct_blocked_wins_even_when_group_has_admin(self) -> None:
        """Direct BLOCKED wins regardless of group grants."""
        role = await _run_lookup(direct_role=ContentRole.BLOCKED, group_roles=[ContentRole.ADMIN])
        assert role == ContentRole.BLOCKED


class TestGroupGrants:
    async def test_group_editor_returned_when_no_direct(self) -> None:
        role = await _run_lookup(direct_role=None, group_roles=[ContentRole.EDITOR])
        assert role == ContentRole.EDITOR

    async def test_group_blocked_returns_blocked(self) -> None:
        role = await _run_lookup(direct_role=None, group_roles=[ContentRole.BLOCKED])
        assert role == ContentRole.BLOCKED

    async def test_group_blocked_wins_over_direct_editor(self) -> None:
        """BLOCKED from a group beats a direct non-BLOCKED grant."""
        role = await _run_lookup(direct_role=ContentRole.EDITOR, group_roles=[ContentRole.BLOCKED])
        assert role == ContentRole.BLOCKED

    async def test_highest_of_two_groups_returned(self) -> None:
        """Two groups with different roles -- the higher one wins."""
        role = await _run_lookup(
            direct_role=None, group_roles=[ContentRole.VIEWER, ContentRole.ADMIN]
        )
        assert role == ContentRole.ADMIN

    async def test_direct_wins_over_lower_group(self) -> None:
        """Direct ADMIN beats group VIEWER."""
        role = await _run_lookup(direct_role=ContentRole.ADMIN, group_roles=[ContentRole.VIEWER])
        assert role == ContentRole.ADMIN

    async def test_group_wins_over_lower_direct(self) -> None:
        """Group ADMIN beats direct VIEWER."""
        role = await _run_lookup(direct_role=ContentRole.VIEWER, group_roles=[ContentRole.ADMIN])
        assert role == ContentRole.ADMIN

    async def test_multiple_groups_blocked_in_one_returns_blocked(self) -> None:
        role = await _run_lookup(
            direct_role=ContentRole.EDITOR,
            group_roles=[ContentRole.VIEWER, ContentRole.BLOCKED],
        )
        assert role == ContentRole.BLOCKED

    async def test_no_direct_no_groups_returns_none(self) -> None:
        role = await _run_lookup(direct_role=None, group_roles=[])
        assert role is None
