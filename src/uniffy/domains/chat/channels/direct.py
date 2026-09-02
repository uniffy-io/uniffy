"""Focused chat channel direct behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import aliased

from uniffy.core.errors import (
    ValidationError,
)
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import (
    SubjectType,
    generate_id,
    slugify,
)
from uniffy.domains.chat.channels.limits import (
    GROUP_DM_MAX_PARTICIPANTS,
)
from uniffy.domains.chat.channels.slugs import slug_suffix
from uniffy.domains.chat.limits import (
    CHANNEL_CREATE,
    check_chat_mutation_limit,
)
from uniffy.domains.chat.senders import SenderResolver
from uniffy.domains.chat.subjects import ChatSubject

logger = logger.bind(component="chat.channels.direct")


class DirectChannels:
    async def create_dm(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_user_ids: list[UUID],
    ) -> ChatChannel:
        """Create or find existing DM (1:1) / GROUP_DM (3+)."""
        await self.access.require_org_member(user_id, organization_id)
        await self._require_active_user_subjects(organization_id, target_user_ids)
        all_user_ids = sorted(set([user_id] + target_user_ids))

        if len(all_user_ids) < 2:
            raise ValidationError("members", "DM requires at least 2 participants")
        if len(all_user_ids) > GROUP_DM_MAX_PARTICIPANTS:
            raise ValidationError(
                "members",
                f"Group chats are limited to {GROUP_DM_MAX_PARTICIPANTS} people. "
                "Create a channel for a bigger group.",
            )

        is_direct = len(all_user_ids) == 2
        channel_type = ChannelType.DIRECT if is_direct else ChannelType.GROUP_DM

        if is_direct:
            existing = await self._find_existing_dm(
                organization_id, all_user_ids[0], all_user_ids[1]
            )
            if existing:
                return existing

        # Name carries ALL participant names; the frontend strips the current user.
        name = await self._build_dm_name(all_user_ids)

        return await self.create_channel(
            user_id=user_id,
            organization_id=organization_id,
            name=name,
            channel_type=channel_type,
            member_ids=target_user_ids,
        )

    async def _find_existing_dm(
        self,
        organization_id: UUID,
        user_a: UUID,
        user_b: UUID,
    ) -> ChatChannel | None:
        m1 = aliased(ChatChannelMember)
        m2 = aliased(ChatChannelMember)

        result = await self.session.execute(
            select(ChatChannel)
            .join(m1, (m1.channel_id == ChatChannel.id) & (m1.user_id == user_a))
            .join(m2, (m2.channel_id == ChatChannel.id) & (m2.user_id == user_b))
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.channel_type == ChannelType.DIRECT,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _build_dm_name(self, user_ids: list[UUID]) -> str:
        return await self._build_dm_name_from_subjects([ChatSubject.user(uid) for uid in user_ids])

    async def _refresh_group_dm_name(self, channel: ChatChannel) -> None:
        """Group-DM names carry the participant list; rebuild after membership changes.

        Caller owns the commit and the live-state refresh.
        """
        member_rows = await self.session.execute(
            select(ChatChannelMember.user_id).where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.user_id.is_not(None),
            )
        )
        user_ids = sorted({row[0] for row in member_rows.all()})
        if user_ids:
            channel.name = await self._build_dm_name(user_ids)

    async def _build_dm_name_from_subjects(self, subjects: list[ChatSubject]) -> str:
        """DM name for mixed USER + AGENT participants via SenderResolver."""
        resolver = SenderResolver(self.session)
        refs = [
            (
                SenderType.USER if s.subject_type == SubjectType.USER else SenderType.AGENT,
                s.subject_id,
            )
            for s in subjects
        ]
        resolved = await resolver.resolve_many(refs)
        names = [
            resolved[s.subject_id].display_name if s.subject_id in resolved else "Unknown"
            for s in subjects
        ]
        if len(names) <= 3:
            return ", ".join(names)
        return f"{', '.join(names[:2])}, and {len(names) - 2} others"

    async def _find_existing_dm_by_subjects(
        self,
        organization_id: UUID,
        a: ChatSubject,
        b: ChatSubject,
    ) -> ChatChannel | None:
        """Existing DIRECT channel between two polymorphic subjects (USER/AGENT pair)."""
        m1 = aliased(ChatChannelMember)
        m2 = aliased(ChatChannelMember)

        result = await self.session.execute(
            select(ChatChannel)
            .join(
                m1,
                (m1.channel_id == ChatChannel.id)
                & (m1.subject_type == a.subject_type)
                & (m1.subject_id == a.subject_id),
            )
            .join(
                m2,
                (m2.channel_id == ChatChannel.id)
                & (m2.subject_type == b.subject_type)
                & (m2.subject_id == b.subject_id),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.channel_type == ChannelType.DIRECT,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    def _build_member_row(
        self,
        channel_id: UUID,
        subject: ChatSubject,
        role: ChannelRole,
    ) -> ChatChannelMember:
        """Mirror subject_id into user_id for USER subjects; NULL for AGENT."""
        return ChatChannelMember(
            channel_id=channel_id,
            subject_type=subject.subject_type,
            subject_id=subject.subject_id,
            user_id=(subject.subject_id if subject.subject_type == SubjectType.USER else None),
            role=role,
        )

    async def create_dm_with_subjects(
        self,
        user_id: UUID,
        organization_id: UUID,
        subjects: list[ChatSubject],
    ) -> ChatChannel:
        """Create / find a DM across mixed USER + AGENT subjects; 1:1 dedup
        by sorted subject tuple.
        """
        await self.access.require_org_member(user_id, organization_id)
        await self._require_active_user_subjects(
            organization_id,
            [s.subject_id for s in subjects if s.subject_type == SubjectType.USER],
        )
        actor_subject = ChatSubject.user(user_id)
        dedup = {s.as_key: s for s in subjects}
        dedup[actor_subject.as_key] = actor_subject
        participants = sorted(dedup.values(), key=lambda s: s.as_key)

        if len(participants) < 2:
            raise ValidationError("members", "DM requires at least 2 participants")
        if len(participants) > 8:
            raise ValidationError("members", "Group DMs support up to 8 participants")

        is_direct = len(participants) == 2
        channel_type = ChannelType.DIRECT if is_direct else ChannelType.GROUP_DM

        if is_direct:
            existing = await self._find_existing_dm_by_subjects(
                organization_id, participants[0], participants[1]
            )
            if existing:
                return existing

        for s in participants:
            if s.subject_type == SubjectType.AGENT:
                await self._require_agent_usable(user_id, organization_id, s.subject_id)

        await check_chat_mutation_limit(
            CHANNEL_CREATE,
            user_id=user_id,
            organization_id=organization_id,
        )

        channel_id = generate_id()
        name = await self._build_dm_name_from_subjects(participants)
        slug = slugify(name)

        # The unique constraint covers soft-deleted rows, so this check must too.
        existing = await self.session.execute(
            select(ChatChannel.id).where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.slug == slug,
            )
        )
        if existing.scalar_one_or_none():
            slug = f"{slug}-{slug_suffix(channel_id)}"

        agent_subjects = [s for s in participants if s.subject_type == SubjectType.AGENT]
        is_agent_dm = is_direct and len(agent_subjects) == 1
        bound_agent_id = agent_subjects[0].subject_id if is_agent_dm else None

        channel = ChatChannel(
            id=channel_id,
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            slug=slug,
            description="",
            channel_type=channel_type,
            is_agent_dm=is_agent_dm,
            agent_id=bound_agent_id,
        )
        self.session.add(channel)
        await self.session.flush()

        self.session.add(ChatChannelStats(channel_id=channel.id, member_count=len(participants)))

        for s in participants:
            role = ChannelRole.OWNER if s == actor_subject else ChannelRole.MEMBER
            self.session.add(self._build_member_row(channel.id, s, role))

        await self._ensure_agent_bindings(
            channel.id,
            [s.subject_id for s in participants if s.subject_type == SubjectType.AGENT],
            actor_user_id=user_id,
        )

        await self.session.commit()
        await self.session.refresh(channel)
        await self._publish_channel_created(channel.id)
        await self._notify_membership_changed(
            channel,
            actor_user_id=user_id,
            target_user_ids=[
                subject.subject_id
                for subject in participants
                if subject.subject_type == SubjectType.USER and subject.subject_id != user_id
            ],
            added=True,
        )
        return channel
