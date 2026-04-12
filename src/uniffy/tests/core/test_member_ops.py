"""Tests for ContentMembersOperations validation logic.

Two layers are tested here:

1. Synchronous validation (_validate_access_mode) -- no DB, no patching.
2. Early-rejection paths in add_member / update_member_role /
   set_access_mode / transfer_ownership -- DB calls are stubbed so we
   only exercise the validation branches.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.content.members import ContentMembersOperations
from uniffy.core.errors import ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.types import generate_id as uuid7


def _make_ops() -> ContentMembersOperations:
    session = MagicMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return ContentMembersOperations(session)


def _fake_content(
    owner_id=None,
    access_mode=AccessMode.EXPLICIT_MEMBERS,
    baseline_role=None,
):
    content = MagicMock()
    content.id = uuid7()
    content.owner_id = owner_id or uuid7()
    content.access_mode = access_mode
    content.baseline_role = baseline_role
    return content


class TestValidateAccessMode:
    """_validate_access_mode is synchronous and has no DB dependency."""

    def test_open_to_org_requires_baseline_role(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="baseline_role"):
            ops._validate_access_mode(AccessMode.OPEN_TO_ORG, None)

    def test_open_to_org_rejects_owner_baseline(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="OWNER"):
            ops._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.OWNER)

    def test_open_to_org_rejects_blocked_baseline(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="BLOCKED"):
            ops._validate_access_mode(AccessMode.OPEN_TO_ORG, ContentRole.BLOCKED)

    @pytest.mark.parametrize("valid_baseline", [
        ContentRole.VIEWER,
        ContentRole.COMMENTER,
        ContentRole.EDITOR,
        ContentRole.ADMIN,
    ])
    def test_open_to_org_accepts_valid_baselines(self, valid_baseline: ContentRole) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.OPEN_TO_ORG, valid_baseline)

    def test_non_open_to_org_rejects_baseline_role(self) -> None:
        ops = _make_ops()
        with pytest.raises(ValidationError, match="baseline_role"):
            ops._validate_access_mode(AccessMode.EXPLICIT_MEMBERS, ContentRole.VIEWER)

    def test_owner_only_with_no_baseline_valid(self) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.OWNER_ONLY, None)

    def test_explicit_members_with_no_baseline_valid(self) -> None:
        ops = _make_ops()
        ops._validate_access_mode(AccessMode.EXPLICIT_MEMBERS, None)


class TestAddMemberRejections:
    """add_member rejects invalid role / access_mode combinations before touching the DB."""

    def _patch_prereqs(self, ops, content, actor_role=ContentRole.ADMIN):
        """Patch _load_content and _require_manage to bypass auth checks."""
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(actor_role, OrganizationRole.MEMBER)),
            ),
        )

    def test_rejects_owner_role(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="transfer_ownership"):
            asyncio.run(
                ops.add_member(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    subject_type=SubjectType.USER,
                    subject_id=uuid7(),
                    role=ContentRole.OWNER,
                )
            )

    def test_rejects_when_owner_only_mode(self) -> None:
        ops = _make_ops()
        content = _fake_content(access_mode=AccessMode.OWNER_ONLY)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="OWNER_ONLY"):
            asyncio.run(
                ops.add_member(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    subject_type=SubjectType.USER,
                    subject_id=uuid7(),
                    role=ContentRole.EDITOR,
                )
            )

    def test_rejects_adding_owner_as_member(self) -> None:
        owner_id = uuid7()
        ops = _make_ops()
        content = _fake_content(owner_id=owner_id)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="Owner cannot be added"):
            asyncio.run(
                ops.add_member(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    subject_type=SubjectType.USER,
                    subject_id=owner_id,
                    role=ContentRole.EDITOR,
                )
            )

    def test_rejects_blocked_on_org_admin(self) -> None:
        """Cannot BLOCK an org admin - the API must reject this explicitly."""
        ops = _make_ops()
        content = _fake_content()
        target_user_id = uuid7()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, patch.object(
            ops.permission_checker,
            "is_org_admin",
            AsyncMock(return_value=True),
        ), pytest.raises(ValidationError, match="Organization admins cannot be blocked"):
            asyncio.run(
                ops.add_member(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    subject_type=SubjectType.USER,
                    subject_id=target_user_id,
                    role=ContentRole.BLOCKED,
                )
            )


class TestUpdateMemberRoleRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(ContentRole.ADMIN, OrganizationRole.MEMBER)),
            ),
        )

    def test_rejects_new_role_owner(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="transfer_ownership"):
            asyncio.run(
                ops.update_member_role(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    subject_type=SubjectType.USER,
                    subject_id=uuid7(),
                    new_role=ContentRole.OWNER,
                )
            )


class TestSetAccessModeRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_manage",
                AsyncMock(return_value=(ContentRole.ADMIN, OrganizationRole.MEMBER)),
            ),
        )

    def test_rejects_open_to_org_without_baseline(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="baseline_role"):
            asyncio.run(
                ops.set_access_mode(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    new_access_mode=AccessMode.OPEN_TO_ORG,
                    new_baseline_role=None,
                )
            )

    def test_rejects_owner_only_when_members_exist_without_flag(self) -> None:
        ops = _make_ops()
        content = _fake_content()

        existing_member = MagicMock()
        existing_member.subject_type = SubjectType.USER
        existing_member.subject_id = uuid7()
        existing_member.role = ContentRole.EDITOR

        member_query_result = MagicMock()
        member_query_result.scalars.return_value.all.return_value = [existing_member]
        ops.session.execute = AsyncMock(return_value=member_query_result)

        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="OWNER_ONLY"):
            asyncio.run(
                ops.set_access_mode(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    new_access_mode=AccessMode.OWNER_ONLY,
                    new_baseline_role=None,
                    remove_members_on_narrow=False,
                )
            )

    def test_accepts_owner_only_with_remove_members_flag(self) -> None:
        """remove_members_on_narrow=True allows the transition and deletes members."""
        ops = _make_ops()
        content = _fake_content()
        content.access_mode = AccessMode.EXPLICIT_MEMBERS

        existing_member = MagicMock()
        existing_member.subject_type = SubjectType.USER
        existing_member.subject_id = uuid7()
        existing_member.role = ContentRole.EDITOR

        member_query_result = MagicMock()
        member_query_result.scalars.return_value.all.return_value = [existing_member]
        ops.session.execute = AsyncMock(return_value=member_query_result)

        search_sync_mock = AsyncMock()

        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1, p2, patch.object(ops, "_sync_search_sharing", search_sync_mock),
            patch.object(ops, "_sync_search_access_policy", AsyncMock()),
        ):
            asyncio.run(
                ops.set_access_mode(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    new_access_mode=AccessMode.OWNER_ONLY,
                    new_baseline_role=None,
                    remove_members_on_narrow=True,
                )
            )
        ops.session.delete.assert_called_once_with(existing_member)


class TestTransferOwnershipRejections:
    def _patch_prereqs(self, ops, content):
        return (
            patch.object(ops, "_load_content", AsyncMock(return_value=content)),
            patch.object(
                ops,
                "_require_transfer",
                AsyncMock(return_value=(ContentRole.OWNER, OrganizationRole.MEMBER)),
            ),
        )

    def test_rejects_same_owner_transfer(self) -> None:
        owner_id = uuid7()
        ops = _make_ops()
        content = _fake_content(owner_id=owner_id)
        p1, p2 = self._patch_prereqs(ops, content)
        with p1, p2, pytest.raises(ValidationError, match="already the current owner"):
            asyncio.run(
                ops.transfer_ownership(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    new_owner_user_id=owner_id,
                )
            )

    def test_rejects_new_owner_not_in_org(self) -> None:
        ops = _make_ops()
        content = _fake_content()
        new_owner = uuid7()
        p1, p2 = self._patch_prereqs(ops, content)
        with (
            p1,
            p2,
            patch.object(ops, "_is_active_org_member", AsyncMock(return_value=False)),
            pytest.raises(ValidationError, match="not an active member"),
        ):
            asyncio.run(
                ops.transfer_ownership(
                    actor_user_id=uuid7(),
                    organization_id=uuid7(),
                    content_type=ContentType.NOTE,
                    content_id=content.id,
                    new_owner_user_id=new_owner,
                )
            )
