"""Unit tests for channel role changes and the owner-leave guard.

DB calls are stubbed; these exercise the permission matrix of
``ChatChannelOperations.update_member_role`` and the sole-owner branch of
``leave_channel``.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _make_channel(channel_type: ChannelType = ChannelType.PUBLIC) -> ChatChannel:
    return ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="general",
        slug="general",
        description="",
        channel_type=channel_type,
    )


def _make_member(role: ChannelRole, user_id=None) -> ChatChannelMember:
    uid = user_id or generate_id()
    return ChatChannelMember(
        channel_id=generate_id(),
        subject_type=SubjectType.USER,
        subject_id=uid,
        user_id=uid,
        role=role,
    )


def _make_ops(channel: ChatChannel) -> ChatChannelOperations:
    ops = ChatChannelOperations.__new__(ChatChannelOperations)
    ops.session = MagicMock()
    ops.session.execute = AsyncMock()
    ops.session.commit = AsyncMock()
    ops.session.refresh = AsyncMock()
    ops.access = MagicMock()
    ops.access.require_org_member = AsyncMock()
    ops.access.get_membership = AsyncMock(return_value=None)
    ops.access.is_org_admin = AsyncMock(return_value=False)
    ops.access.is_chat_domain_admin = AsyncMock(return_value=False)
    ops.access.invalidate_membership = MagicMock()
    ops.get_by_id = AsyncMock(return_value=channel)
    ops._publish_member_role_changed = AsyncMock()
    ops._call_lifecycle = MagicMock()
    ops._call_lifecycle.remove_member = AsyncMock()
    return ops


def _result(scalar_one_or_none=None, scalar_one=None, one=None):
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar_one_or_none
    result.scalar_one.return_value = scalar_one
    result.one.return_value = one
    return result


def _patch_side_effects():
    return patch.multiple(
        "uniffy.domains.chat.channels.members",
        write_audit_event=AsyncMock(),
        invalidate_cached_member_ids=AsyncMock(),
    )


class TestUpdateMemberRole:
    def _call(self, ops, channel, actor_id=None, target_id=None, role=ChannelRole.ADMIN):
        return ops.update_member_role(
            actor_id or generate_id(),
            channel.organization_id,
            channel.id,
            target_id or generate_id(),
            role,
        )

    async def test_direct_dm_rejected(self) -> None:
        channel = _make_channel(ChannelType.DIRECT)
        ops = _make_ops(channel)
        with pytest.raises(ValidationError, match="roles"):
            await self._call(ops, channel)

    async def test_plain_member_actor_rejected(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.MEMBER)
        with pytest.raises(PermissionDeniedError):
            await self._call(ops, channel)

    async def test_admin_actor_cannot_grant_owner(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.ADMIN)
        target = _make_member(ChannelRole.MEMBER)
        ops.session.execute.return_value = _result(scalar_one_or_none=target)
        with pytest.raises(PermissionDeniedError, match="owner"):
            await self._call(ops, channel, role=ChannelRole.OWNER)

    async def test_admin_actor_cannot_demote_owner(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.ADMIN)
        target = _make_member(ChannelRole.OWNER)
        ops.session.execute.return_value = _result(scalar_one_or_none=target)
        with pytest.raises(PermissionDeniedError, match="owner"):
            await self._call(ops, channel, role=ChannelRole.MEMBER)

    async def test_admin_actor_promotes_member_to_admin(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.ADMIN)
        target = _make_member(ChannelRole.MEMBER)
        user = MagicMock(full_name="Target User")
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=user),
        ]
        with _patch_side_effects():
            member, _ = await self._call(ops, channel, role=ChannelRole.ADMIN)
        assert member.role == ChannelRole.ADMIN
        ops.session.commit.assert_awaited_once()
        ops._publish_member_role_changed.assert_awaited_once()

    async def test_owner_actor_promotes_member_to_owner(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER)
        target = _make_member(ChannelRole.MEMBER)
        user = MagicMock(full_name="Target User")
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=user),
        ]
        with _patch_side_effects():
            member, _ = await self._call(ops, channel, role=ChannelRole.OWNER)
        assert member.role == ChannelRole.OWNER

    async def test_last_owner_cannot_be_demoted(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        actor_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER, user_id=actor_id)
        target = _make_member(ChannelRole.OWNER, user_id=actor_id)
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=1),
        ]
        with pytest.raises(ValidationError, match="Promote another member"):
            await self._call(
                ops,
                channel,
                actor_id=actor_id,
                target_id=actor_id,
                role=ChannelRole.MEMBER,
            )

    async def test_co_owner_can_be_demoted(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER)
        target = _make_member(ChannelRole.OWNER)
        user = MagicMock(full_name="Co Owner")
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=2),
            _result(scalar_one=user),
        ]
        with _patch_side_effects():
            member, _ = await self._call(ops, channel, role=ChannelRole.MEMBER)
        assert member.role == ChannelRole.MEMBER

    async def test_org_admin_moderation_path_can_grant_owner(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = None
        ops.access.is_org_admin.return_value = True
        target = _make_member(ChannelRole.MEMBER)
        user = MagicMock(full_name="Target User")
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=user),
        ]
        with _patch_side_effects():
            member, _ = await self._call(ops, channel, role=ChannelRole.OWNER)
        assert member.role == ChannelRole.OWNER

    async def test_unknown_target_raises_not_found(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER)
        ops.session.execute.return_value = _result(scalar_one_or_none=None)
        with pytest.raises(NotFoundError):
            await self._call(ops, channel)

    async def test_same_role_is_a_no_op(self) -> None:
        channel = _make_channel()
        ops = _make_ops(channel)
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER)
        target = _make_member(ChannelRole.ADMIN)
        user = MagicMock(full_name="Target User")
        ops.session.execute.side_effect = [
            _result(scalar_one_or_none=target),
            _result(scalar_one=user),
        ]
        member, _ = await self._call(ops, channel, role=ChannelRole.ADMIN)
        assert member.role == ChannelRole.ADMIN
        ops.session.commit.assert_not_awaited()
        ops._publish_member_role_changed.assert_not_awaited()


class TestLeaveChannelOwnerGuard:
    def _make_leave_ops(self, channel: ChatChannel) -> ChatChannelOperations:
        ops = _make_ops(channel)
        ops._fetch_by_id = AsyncMock(return_value=channel)
        ops._refresh_group_dm_name = AsyncMock()
        ops._post_membership_system_message = AsyncMock()
        ops._publish_member_event = AsyncMock()
        ops._refresh_channel_live_state = AsyncMock()
        return ops

    def _leave_patches(self):
        return patch.multiple(
            "uniffy.domains.chat.channels.lifecycle",
            invalidate_cached_member_ids=AsyncMock(),
            invalidate_cached_dm_peers=AsyncMock(),
        )

    async def test_sole_owner_with_other_members_blocked(self) -> None:
        channel = _make_channel(ChannelType.PRIVATE)
        ops = self._make_leave_ops(channel)
        user_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER, user_id=user_id)
        ops.session.execute.return_value = _result(one=(1, 3))
        with pytest.raises(ValidationError, match="Promote another member"):
            await ops.leave_channel(user_id, channel.organization_id, channel.id)

    async def test_owner_with_co_owner_can_leave(self) -> None:
        channel = _make_channel(ChannelType.PRIVATE)
        ops = self._make_leave_ops(channel)
        user_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER, user_id=user_id)
        ops.session.execute.side_effect = [
            _result(one=(2, 3)),
            _result(),
            _result(),
        ]
        with self._leave_patches():
            await ops.leave_channel(user_id, channel.organization_id, channel.id)
        ops._publish_member_event.assert_awaited_once()

    async def test_sole_owner_alone_can_leave(self) -> None:
        channel = _make_channel(ChannelType.PRIVATE)
        ops = self._make_leave_ops(channel)
        user_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.OWNER, user_id=user_id)
        ops.session.execute.side_effect = [
            _result(one=(1, 1)),
            _result(),
            _result(),
        ]
        with self._leave_patches():
            await ops.leave_channel(user_id, channel.organization_id, channel.id)
        ops._publish_member_event.assert_awaited_once()

    async def test_plain_member_leaves_without_owner_query(self) -> None:
        channel = _make_channel(ChannelType.PRIVATE)
        ops = self._make_leave_ops(channel)
        user_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.MEMBER, user_id=user_id)
        ops.session.execute.side_effect = [_result(), _result()]
        with self._leave_patches():
            await ops.leave_channel(user_id, channel.organization_id, channel.id)
        assert ops.session.execute.await_count == 2

    async def test_group_dm_leave_refreshes_name_and_peers(self) -> None:
        channel = _make_channel(ChannelType.GROUP_DM)
        ops = self._make_leave_ops(channel)
        user_id = generate_id()
        ops.access.get_membership.return_value = _make_member(ChannelRole.MEMBER, user_id=user_id)
        ops.session.execute.side_effect = [_result(), _result()]
        peers_mock = AsyncMock()
        with patch.multiple(
            "uniffy.domains.chat.channels.lifecycle",
            invalidate_cached_member_ids=AsyncMock(),
            invalidate_cached_dm_peers=peers_mock,
        ):
            await ops.leave_channel(user_id, channel.organization_id, channel.id)
        ops._refresh_group_dm_name.assert_awaited_once()
        peers_mock.assert_awaited_once_with(channel.id)

    async def test_direct_dm_leave_rejected(self) -> None:
        channel = _make_channel(ChannelType.DIRECT)
        ops = self._make_leave_ops(channel)
        with pytest.raises(ValidationError, match="direct message"):
            await ops.leave_channel(generate_id(), channel.organization_id, channel.id)
