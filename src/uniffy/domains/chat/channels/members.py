"""Focused chat channel members behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
    ChatNotificationLevel,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import (
    SubjectType,
)
from uniffy.domains.chat.cache import (
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.channels.state import StagedChatMembersAdd, StagedChatMembersRemove
from uniffy.domains.chat.limits import (
    MEMBER_ADD,
    check_chat_mutation_limit,
)
from uniffy.domains.chat.search import (
    enqueue_chat_search_acl_refresh,
    record_chat_search_acl_refresh,
)

logger = logger.bind(component="chat.channels.members")


class ChannelMembers:
    async def add_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> list[ChatChannelMember]:
        staged = await self.stage_members(
            user_id,
            organization_id,
            channel_id,
            member_user_ids,
        )
        if not staged.added:
            return []
        await self.session.commit()
        await self.finish_members_add_after_commit(staged)
        return list(staged.added)

    async def stage_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> StagedChatMembersAdd:
        """Add members; one ON CONFLICT DO NOTHING RETURNING tells us who was actually inserted."""
        channel = await self.get_by_id(user_id, organization_id, channel_id)
        await self._require_edit(user_id, organization_id, channel)

        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            raise ValidationError("channel", "Cannot add members to DMs")

        if not member_user_ids:
            return StagedChatMembersAdd(channel, user_id, organization_id, ())

        await self._require_active_user_subjects(organization_id, member_user_ids)
        await check_chat_mutation_limit(
            MEMBER_ADD,
            user_id=user_id,
            organization_id=organization_id,
        )

        rows = [
            {
                "channel_id": channel_id,
                "subject_type": SubjectType.USER,
                "subject_id": mid,
                "user_id": mid,
                "role": ChannelRole.MEMBER,
            }
            for mid in member_user_ids
        ]

        stmt = (
            pg_insert(ChatChannelMember)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["channel_id", "subject_type", "subject_id"])
            .returning(ChatChannelMember)
        )
        result = await self.session.execute(stmt)
        added = list(result.scalars().all())

        if added:
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count + len(added))
            )

            for member in added:
                if member.user_id is not None:
                    await write_audit_event(
                        self.session,
                        organization_id=organization_id,
                        actor_user_id=user_id,
                        action=Action.CHAT_CHANNEL_MEMBER_ADDED,
                        resource_type=AuditResourceType.CHAT,
                        resource_id=channel_id,
                        details={
                            "target_user_id": str(member.user_id),
                            "role": member.role.value,
                        },
                    )

            if channel.channel_type != ChannelType.PUBLIC:
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )

            await self.session.flush()

        return StagedChatMembersAdd(channel, user_id, organization_id, tuple(added))

    async def finish_members_add_after_commit(self, staged: StagedChatMembersAdd) -> None:
        if not staged.added:
            return

        channel_id = staged.channel.id
        if staged.channel.channel_type != ChannelType.PUBLIC:
            await enqueue_chat_search_acl_refresh(channel_id)

        await invalidate_cached_member_ids(channel_id)
        added_user_ids = [m.user_id for m in staged.added if m.user_id is not None]
        await self._publish_members_changed(channel_id, added_user_ids, added=True)
        await self._notify_membership_changed(
            staged.channel,
            actor_user_id=staged.actor_user_id,
            target_user_ids=added_user_ids,
            added=True,
        )
        await self._refresh_channel_live_state(staged.channel)

    async def remove_members(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> None:
        staged = await self.stage_members_remove(
            user_id,
            organization_id,
            channel_id,
            member_user_ids,
        )
        if not staged.removed_user_ids:
            return
        await self.session.commit()
        await self.finish_members_remove_after_commit(staged)

    async def stage_members_remove(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        member_user_ids: list[UUID],
    ) -> StagedChatMembersRemove:
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot remove members from a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            is_self_leave = set(member_user_ids) == {user_id}
            if not is_self_leave:
                membership = await self.access.get_membership(channel_id, user_id)
                if membership is None or membership.role != ChannelRole.OWNER:
                    raise PermissionDeniedError(
                        "members", "Only the conversation owner can remove people"
                    )
        else:
            await self._require_edit(user_id, organization_id, channel)

        members_result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id.in_(member_user_ids),
            )
        )
        members = list(members_result.scalars().all())

        removable_ids = tuple(
            member.user_id
            for member in members
            if member.role != ChannelRole.OWNER and member.user_id is not None
        )

        if removable_ids:
            await self.session.execute(
                delete(ChatChannelMember).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.user_id.in_(removable_ids),
                )
            )
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count - len(removable_ids))
            )

            for removed_id in removable_ids:
                self_removal = removed_id == user_id
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=(
                        Action.CHAT_CHANNEL_MEMBER_REMOVED
                        if self_removal
                        else Action.CHAT_CHANNEL_MEMBER_KICKED
                    ),
                    resource_type=AuditResourceType.CHAT,
                    resource_id=channel_id,
                    details={"target_user_id": str(removed_id)},
                )

            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC:
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.flush()

        return StagedChatMembersRemove(
            channel=channel,
            actor_user_id=user_id,
            organization_id=organization_id,
            removed_user_ids=removable_ids,
        )

    async def finish_members_remove_after_commit(self, staged: StagedChatMembersRemove) -> None:
        if not staged.removed_user_ids:
            return

        channel_id = staged.channel.id
        if staged.channel.channel_type != ChannelType.PUBLIC:
            await enqueue_chat_search_acl_refresh(channel_id)

        await invalidate_cached_member_ids(channel_id)
        if staged.channel.channel_type == ChannelType.GROUP_DM:
            await invalidate_cached_dm_peers(channel_id)

        for removed_id in staged.removed_user_ids:
            await self.call_lifecycle.remove_member(self.session, channel_id, removed_id)

        await self._publish_members_changed(
            channel_id,
            list(staged.removed_user_ids),
            added=False,
        )
        await self._notify_membership_changed(
            staged.channel,
            actor_user_id=staged.actor_user_id,
            target_user_ids=list(staged.removed_user_ids),
            added=False,
        )
        await self._refresh_channel_live_state(staged.channel)

    _MUTED_UNTIL_UNSET = object()

    async def update_member(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        target_user_id: UUID,
        is_muted: bool | None = None,
        notification_level: str | None = None,
        muted_until: object = _MUTED_UNTIL_UNSET,
        follow_all_threads: bool | None = None,
        badge_all_messages: bool | None = None,
    ) -> tuple[ChatChannelMember, User]:
        """Update a member's preferences; muted_until uses a sentinel to
        distinguish unset vs clear.
        """
        await self.get_by_id(user_id, organization_id, channel_id)

        if user_id != target_user_id:
            is_elevated = await self.access.require_elevated(
                user_id,
                organization_id,
                channel_id,
            )
            if not is_elevated:
                raise PermissionDeniedError("update_member", "Can only update your own membership")

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.user_id == target_user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundError("channel_member", target_user_id)

        if is_muted is not None:
            member.is_muted = is_muted
            if not is_muted:
                member.muted_until = None

        if muted_until is not self._MUTED_UNTIL_UNSET:
            if muted_until is not None:
                member.is_muted = True
                member.muted_until = muted_until
            else:
                member.muted_until = None

        if notification_level is not None:
            member.notification_level = ChatNotificationLevel(notification_level)
        if follow_all_threads is not None:
            member.follow_all_threads = follow_all_threads
        if badge_all_messages is not None:
            member.badge_all_messages = badge_all_messages

        await self.session.commit()
        await self.session.refresh(member)

        user_result = await self.session.execute(select(User).where(User.id == target_user_id))
        user = user_result.scalar_one()
        return member, user

    async def update_member_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        target_user_id: UUID,
        role: ChannelRole,
    ) -> tuple[ChatChannelMember, User]:
        """Change a USER member's channel role.

        Channel admins move members between MEMBER and ADMIN; granting or
        revoking OWNER takes an owner (or chat moderation) actor, and the
        last owner can never be demoted.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "1:1 DMs have no roles")

        actor_member = await self.access.get_membership(channel_id, user_id)
        actor_is_owner = bool(actor_member and actor_member.role == ChannelRole.OWNER)
        if not actor_is_owner:
            actor_is_owner = await self.access.is_org_admin(
                user_id, organization_id
            ) or await self.access.is_chat_domain_admin(user_id, organization_id)
        actor_is_admin = actor_is_owner or bool(
            actor_member and actor_member.role == ChannelRole.ADMIN
        )
        if not actor_is_admin:
            raise PermissionDeniedError("members", "Only channel admins can change roles")

        result = await self.session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == target_user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundError("channel_member", target_user_id)

        touches_owner = ChannelRole.OWNER in (role, member.role)
        if touches_owner and not actor_is_owner:
            raise PermissionDeniedError("members", "Only an owner can grant or revoke ownership")

        if member.role == ChannelRole.OWNER and role != ChannelRole.OWNER:
            owners_result = await self.session.execute(
                select(func.count())
                .select_from(ChatChannelMember)
                .where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                    ChatChannelMember.role == ChannelRole.OWNER,
                )
            )
            if owners_result.scalar_one() <= 1:
                raise ValidationError("role", "Promote another member to owner first")

        user_result = await self.session.execute(select(User).where(User.id == target_user_id))
        user = user_result.scalar_one()

        if member.role == role:
            return member, user

        old_role = member.role
        member.role = role

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_MEMBER_ROLE_CHANGED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel_id,
            details={
                "target_user_id": str(target_user_id),
                "old_role": old_role.value,
                "new_role": role.value,
            },
        )

        await self.session.commit()
        await self.session.refresh(member)

        self.access.invalidate_membership(channel_id, target_user_id)
        await invalidate_cached_member_ids(channel_id)

        await self._publish_member_role_changed(
            channel_id, target_user_id, role, user.full_name or ""
        )

        return member, user
