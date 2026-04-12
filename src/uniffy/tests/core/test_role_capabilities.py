"""Tests for role capability predicates and ordinal helpers.

Covers every combination of role (including None) against every
role_can_* predicate. These functions are the single source of truth
for capability decisions; any regression here silently breaks all access
control across the application.
"""

import pytest

from uniffy.core.auth.permissions.roles import (
    ROLE_ORDINAL,
    max_role,
    role_can_comment,
    role_can_delete,
    role_can_edit,
    role_can_manage,
    role_can_transfer,
    role_can_view,
    role_is_higher_than,
)
from uniffy.core.types import ContentRole


class TestRoleOrdinals:
    """Verify the ordinal table is self-consistent."""

    def test_blocked_has_lowest_ordinal(self) -> None:
        assert ROLE_ORDINAL[ContentRole.BLOCKED] < ROLE_ORDINAL[ContentRole.VIEWER]

    def test_ordinal_order_is_strictly_ascending(self) -> None:
        ordered = [
            ContentRole.BLOCKED,
            ContentRole.VIEWER,
            ContentRole.COMMENTER,
            ContentRole.EDITOR,
            ContentRole.ADMIN,
            ContentRole.OWNER,
        ]
        for i in range(len(ordered) - 1):
            assert ROLE_ORDINAL[ordered[i]] < ROLE_ORDINAL[ordered[i + 1]]

    def test_all_six_roles_present(self) -> None:
        assert set(ROLE_ORDINAL.keys()) == set(ContentRole)


class TestRoleCanView:
    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, True),
            (ContentRole.EDITOR, True),
            (ContentRole.COMMENTER, True),
            (ContentRole.VIEWER, True),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_view(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_view(role) is expected


class TestRoleCanComment:
    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, True),
            (ContentRole.EDITOR, True),
            (ContentRole.COMMENTER, True),
            (ContentRole.VIEWER, False),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_comment(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_comment(role) is expected


class TestRoleCanEdit:
    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, True),
            (ContentRole.EDITOR, True),
            (ContentRole.COMMENTER, False),
            (ContentRole.VIEWER, False),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_edit(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_edit(role) is expected


class TestRoleCanDelete:
    """Delete requires ADMIN or above (same threshold as manage)."""

    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, True),
            (ContentRole.EDITOR, False),
            (ContentRole.COMMENTER, False),
            (ContentRole.VIEWER, False),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_delete(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_delete(role) is expected


class TestRoleCanManage:
    """Manage (add/remove members, change access mode) requires ADMIN+."""

    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, True),
            (ContentRole.EDITOR, False),
            (ContentRole.COMMENTER, False),
            (ContentRole.VIEWER, False),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_manage(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_manage(role) is expected

    def test_delete_and_manage_have_same_threshold(self) -> None:
        """Delete and manage share the ADMIN floor -- keep them in sync."""
        for role in list(ContentRole) + [None]:
            assert role_can_delete(role) == role_can_manage(role), (
                f"role_can_delete and role_can_manage diverged for {role}"
            )


class TestRoleCanTransfer:
    """Transfer ownership requires OWNER (org/domain admin bypass is handled at a higher layer)."""

    @pytest.mark.parametrize(
        "role,expected",
        [
            (ContentRole.OWNER, True),
            (ContentRole.ADMIN, False),
            (ContentRole.EDITOR, False),
            (ContentRole.COMMENTER, False),
            (ContentRole.VIEWER, False),
            (ContentRole.BLOCKED, False),
            (None, False),
        ],
    )
    def test_role_can_transfer(self, role: ContentRole | None, expected: bool) -> None:
        assert role_can_transfer(role) is expected


class TestRoleIsHigherThan:
    def test_owner_higher_than_admin(self) -> None:
        assert role_is_higher_than(ContentRole.OWNER, ContentRole.ADMIN) is True

    def test_admin_higher_than_editor(self) -> None:
        assert role_is_higher_than(ContentRole.ADMIN, ContentRole.EDITOR) is True

    def test_editor_not_higher_than_admin(self) -> None:
        assert role_is_higher_than(ContentRole.EDITOR, ContentRole.ADMIN) is False

    def test_equal_roles_not_higher(self) -> None:
        assert role_is_higher_than(ContentRole.VIEWER, ContentRole.VIEWER) is False

    def test_blocked_lower_than_viewer(self) -> None:
        assert role_is_higher_than(ContentRole.VIEWER, ContentRole.BLOCKED) is True
        assert role_is_higher_than(ContentRole.BLOCKED, ContentRole.VIEWER) is False


class TestMaxRole:
    def test_returns_none_for_empty_list(self) -> None:
        assert max_role([]) is None

    def test_single_role_returned(self) -> None:
        assert max_role([ContentRole.EDITOR]) == ContentRole.EDITOR

    def test_highest_of_multiple_roles(self) -> None:
        roles = [ContentRole.VIEWER, ContentRole.ADMIN, ContentRole.EDITOR]
        assert max_role(roles) == ContentRole.ADMIN

    def test_blocked_is_lowest(self) -> None:
        assert max_role([ContentRole.BLOCKED, ContentRole.VIEWER]) == ContentRole.VIEWER

    def test_all_roles_owner_wins(self) -> None:
        all_roles = list(ContentRole)
        assert max_role(all_roles) == ContentRole.OWNER

    def test_duplicates_handled(self) -> None:
        assert max_role([ContentRole.EDITOR, ContentRole.EDITOR]) == ContentRole.EDITOR
