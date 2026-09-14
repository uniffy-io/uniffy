"""Focused chat channel subjects behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy import tuple_ as sa_tuple
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import (
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.chat.message import ChatMessageMetadataKind, SenderType
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.types import (
    SubjectType,
)
from uniffy.domains.chat.cache import (
    invalidate_cached_dm_peers,
    invalidate_cached_member_ids,
)
from uniffy.domains.chat.channels.limits import (
    GROUP_DM_CAP_MESSAGE,
    GROUP_DM_MAX_PARTICIPANTS,
)
from uniffy.domains.chat.limits import (
    MEMBER_ADD,
    check_chat_mutation_limit,
)
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.search import (
    enqueue_chat_search_acl_refresh,
    record_chat_search_acl_refresh,
)
from uniffy.domains.chat.senders import SenderResolver
from uniffy.domains.chat.subjects import ChatSubject

logger = logger.bind(component="chat.channels.subjects")


class ChannelSubjects:
    async def add_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> list[ChatChannelMember]:
        """Add USER/AGENT members; actor needs channel MANAGE plus VIEWER+ on each AGENT.

        Group DMs: any participant can add people (users only, capped at
        GROUP_DM_MAX_PARTICIPANTS); 1:1 DMs stay immutable - adding a third
        person means a new conversation.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot add members to a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            membership = await self.access.get_membership(channel_id, user_id)
            if membership is None:
                raise PermissionDeniedError("members", "Only participants can add people")
            if any(s.subject_type != SubjectType.USER for s in subjects):
                raise ValidationError("members", "Group DMs only contain users")
            count_result = await self.session.execute(
                select(func.count()).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                )
            )
            current_count = count_result.scalar_one()
            if current_count + len({s.subject_id for s in subjects}) > GROUP_DM_MAX_PARTICIPANTS:
                raise ValidationError("members", GROUP_DM_CAP_MESSAGE)
        else:
            await self._require_edit(user_id, organization_id, channel)

        if not subjects:
            return []

        await self._require_active_user_subjects(
            organization_id,
            [s.subject_id for s in subjects if s.subject_type == SubjectType.USER],
        )

        for s in subjects:
            if s.subject_type == SubjectType.AGENT:
                await self._require_agent_usable(user_id, organization_id, s.subject_id)

        await check_chat_mutation_limit(
            MEMBER_ADD,
            user_id=user_id,
            organization_id=organization_id,
        )

        rows = [
            {
                "channel_id": channel_id,
                "subject_type": s.subject_type,
                "subject_id": s.subject_id,
                "user_id": (s.subject_id if s.subject_type == SubjectType.USER else None),
                "role": ChannelRole.MEMBER,
            }
            for s in subjects
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
            await self._ensure_agent_bindings(
                channel_id,
                [m.subject_id for m in added if m.subject_type == SubjectType.AGENT],
                actor_user_id=user_id,
            )
            for member in added:
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=Action.CHAT_CHANNEL_MEMBER_ADDED,
                    resource_type=AuditResourceType.CHAT,
                    resource_id=channel_id,
                    details={
                        "target_subject_type": member.subject_type.value,
                        "target_subject_id": str(member.subject_id),
                        "role": member.role.value,
                    },
                )
            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC and any(
                member.subject_type == SubjectType.USER for member in added
            ):
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC and any(
                member.subject_type == SubjectType.USER for member in added
            ):
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)
            if channel.channel_type == ChannelType.GROUP_DM:
                await invalidate_cached_dm_peers(channel_id)

            await self._publish_members_changed(
                channel_id,
                [
                    m.user_id
                    for m in added
                    if m.subject_type == SubjectType.USER and m.user_id is not None
                ],
                added=True,
                agents_affected=any(m.subject_type == SubjectType.AGENT for m in added),
            )
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=[
                    member.subject_id for member in added if member.subject_type == SubjectType.USER
                ],
                added=True,
            )

            await self._post_membership_system_message(
                user_id,
                organization_id,
                channel,
                [ChatSubject(m.subject_type, m.subject_id) for m in added],
                added=True,
            )

            await self._refresh_channel_live_state(channel)

        return added

    async def _require_active_user_subjects(
        self,
        organization_id: UUID,
        user_ids: list[UUID],
    ) -> None:
        unique_ids = set(user_ids)
        if not unique_ids:
            return
        result = await self.session.execute(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id.in_(unique_ids),
                OrganizationMember.is_active.is_(True),
            )
        )
        active_ids = set(result.scalars().all())
        if active_ids != unique_ids:
            raise ValidationError(
                "members",
                "Every user subject must be an active member of the organization",
            )

    async def remove_members_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        subjects: list[ChatSubject],
    ) -> None:
        """Remove USER/AGENT members; owners cannot be removed.

        Group DMs: the conversation owner can remove others; anyone can remove
        themselves (leave). 1:1 DMs stay immutable.
        """
        channel = await self.get_by_id(user_id, organization_id, channel_id)

        if channel.channel_type == ChannelType.DIRECT:
            raise ValidationError("channel", "Cannot remove members from a 1:1 DM")

        if channel.channel_type == ChannelType.GROUP_DM:
            is_self_leave = {s.subject_id for s in subjects} == {user_id}
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
                ChatChannelMember.subject_id.in_([s.subject_id for s in subjects]),
            )
        )
        members = list(members_result.scalars().all())
        removable = [(m.subject_type, m.subject_id) for m in members if m.role != ChannelRole.OWNER]

        if removable:
            await self.session.execute(
                delete(ChatChannelMember).where(
                    ChatChannelMember.channel_id == channel_id,
                    sa_tuple(
                        ChatChannelMember.subject_type,
                        ChatChannelMember.subject_id,
                    ).in_([(t, i) for (t, i) in removable]),
                )
            )
            await self.session.execute(
                update(ChatChannelStats)
                .where(ChatChannelStats.channel_id == channel_id)
                .values(member_count=ChatChannelStats.member_count - len(removable))
            )
            for subject_type, subject_id in removable:
                self_removal = subject_type == SubjectType.USER and subject_id == user_id
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
                    details={
                        "target_subject_type": subject_type.value,
                        "target_subject_id": str(subject_id),
                    },
                )
            if channel.channel_type == ChannelType.GROUP_DM:
                await self._refresh_group_dm_name(channel)
            if channel.channel_type != ChannelType.PUBLIC and any(
                subject_type == SubjectType.USER for subject_type, _ in removable
            ):
                await record_chat_search_acl_refresh(
                    self.session,
                    organization_id=organization_id,
                    channel_id=channel_id,
                )
            await self.session.commit()

            if channel.channel_type != ChannelType.PUBLIC and any(
                subject_type == SubjectType.USER for subject_type, _ in removable
            ):
                await enqueue_chat_search_acl_refresh(channel_id)

            await invalidate_cached_member_ids(channel_id)
            if channel.channel_type == ChannelType.GROUP_DM:
                await invalidate_cached_dm_peers(channel_id)

            removed_user_ids = [sid for (t, sid) in removable if t == SubjectType.USER]
            for removed_user_id in removed_user_ids:
                await self.call_lifecycle.remove_member(
                    self.session,
                    channel_id,
                    removed_user_id,
                )

            await self._publish_members_changed(
                channel_id,
                removed_user_ids,
                added=False,
                agents_affected=any(t == SubjectType.AGENT for (t, _sid) in removable),
            )
            await self._notify_membership_changed(
                channel,
                actor_user_id=user_id,
                target_user_ids=removed_user_ids,
                added=False,
            )

            await self._post_membership_system_message(
                user_id,
                organization_id,
                channel,
                [ChatSubject(t, i) for (t, i) in removable],
                added=False,
            )

            await self._refresh_channel_live_state(channel)

    async def _post_membership_system_message(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
        subjects: list[ChatSubject],
        *,
        added: bool,
    ) -> None:
        """Post "Actor added/removed X, Y" as a SYSTEM message; non-fatal."""
        try:
            resolver = SenderResolver(self.session)
            refs = [(SenderType.USER, actor_user_id)] + [
                (
                    SenderType.USER if s.subject_type == SubjectType.USER else SenderType.AGENT,
                    s.subject_id,
                )
                for s in subjects
            ]
            # resolve_many keys its result by bare id.
            infos = await resolver.resolve_many(refs)

            def mention(sender_type: SenderType, subject_id: UUID) -> str:
                info = infos.get(subject_id)
                name = sanitize_mention_label(info.display_name if info else "Someone")
                urn_type = "USER" if sender_type == SenderType.USER else "AGENT"
                return f"[[[{name}|urn:uniffy:content:{urn_type}:{subject_id}]]]"

            actor = mention(SenderType.USER, actor_user_id)
            targets = ", ".join(mention(t, i) for t, i in refs[1:])
            is_self = len(subjects) == 1 and subjects[0].subject_id == actor_user_id
            place = (
                "the conversation" if channel.channel_type == ChannelType.GROUP_DM else "the channel"
            )
            action = "added" if added else "removed"
            if is_self and not added:
                content = f"{actor} left {place}"
            elif added:
                content = f"{actor} {action} {targets} to {place}"
            else:
                content = f"{actor} {action} {targets} from {place}"

            msg_ops = ChatMessageOperations(
                self.session,
                storage=self.storage,
                search_indexer=self.search_indexer,
            )
            await msg_ops.send_message(
                user_id=actor_user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=content,
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post membership system message for channel {channel.id}")

    async def _post_join_system_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        try:
            user_result = await self.session.execute(
                select(User.full_name).where(User.id == user_id)
            )
            user_name = sanitize_mention_label(user_result.scalar_one_or_none() or "Someone")

            mention = f"[[[{user_name}|urn:uniffy:content:USER:{user_id}]]]"
            content = f"{mention} joined the channel"

            msg_ops = ChatMessageOperations(
                self.session,
                storage=self.storage,
                search_indexer=self.search_indexer,
            )
            await msg_ops.send_message(
                user_id=user_id,
                organization_id=organization_id,
                channel_id=channel.id,
                content=content,
                message_metadata={"kind": ChatMessageMetadataKind.MEMBER_JOINED.value},
                sender_type=SenderType.SYSTEM,
            )
        except Exception:
            logger.warning(f"Failed to post join system message for {user_id}")
