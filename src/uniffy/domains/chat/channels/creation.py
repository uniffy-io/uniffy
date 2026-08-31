"""Focused chat channel creation behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
)
from uniffy.core.types import (
    SubjectType,
    generate_id,
    slugify,
)
from uniffy.domains.chat.channels.slugs import slug_suffix
from uniffy.domains.chat.channels.state import StagedChatChannelCreate
from uniffy.domains.chat.limits import (
    CHANNEL_CREATE,
    check_chat_mutation_limit,
)

logger = logger.bind(component="chat.channels.creation")


class ChannelCreation:
    async def create_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        channel_type: ChannelType,
        description: str = "",
        icon: str = "",
        is_default: bool = False,
        category_id: UUID | None = None,
        member_ids: list[UUID] | None = None,
        tag_ids: list[UUID] | None = None,
    ) -> ChatChannel:
        try:
            staged = await self.stage_channel(
                user_id=user_id,
                organization_id=organization_id,
                name=name,
                channel_type=channel_type,
                description=description,
                icon=icon,
                is_default=is_default,
                category_id=category_id,
                member_ids=member_ids,
                tag_ids=tag_ids,
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(staged.channel)
        await self.finish_channel_create_after_commit(staged)
        return staged.channel

    async def stage_channel(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        channel_type: ChannelType,
        description: str = "",
        icon: str = "",
        is_default: bool = False,
        category_id: UUID | None = None,
        member_ids: list[UUID] | None = None,
        tag_ids: list[UUID] | None = None,
    ) -> StagedChatChannelCreate:
        """Create a channel with stats row and initial membership."""
        await self.access.require_org_member(user_id, organization_id)
        initial_member_ids = list(dict.fromkeys(member_ids or []))
        await self._require_active_user_subjects(organization_id, initial_member_ids)
        if category_id is not None:
            category = await self.session.execute(
                select(ChatChannelCategory.id).where(
                    ChatChannelCategory.id == category_id,
                    ChatChannelCategory.organization_id == organization_id,
                )
            )
            if category.scalar_one_or_none() is None:
                raise NotFoundError("category", category_id)
        await check_chat_mutation_limit(
            CHANNEL_CREATE,
            user_id=user_id,
            organization_id=organization_id,
        )
        channel_id = generate_id()
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

        channel = ChatChannel(
            id=channel_id,
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            slug=slug,
            description=description,
            channel_type=channel_type,
            icon=icon,
            is_default=is_default,
            category_id=category_id,
        )
        self.session.add(channel)
        await self.session.flush()

        stats = ChatChannelStats(channel_id=channel.id, member_count=1)
        self.session.add(stats)

        creator_member = ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            user_id=user_id,
            role=ChannelRole.OWNER,
        )
        self.session.add(creator_member)

        if initial_member_ids:
            count = 1
            for mid in initial_member_ids:
                if mid != user_id:
                    m = ChatChannelMember(
                        channel_id=channel.id,
                        subject_type=SubjectType.USER,
                        subject_id=mid,
                        user_id=mid,
                        role=ChannelRole.MEMBER,
                    )
                    self.session.add(m)
                    count += 1
            stats.member_count = count

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CHAT_CHANNEL_CREATED,
            resource_type=AuditResourceType.CHAT,
            resource_id=channel.id,
            details={
                "name": channel.name,
                "channel_type": channel_type.value,
                "is_default": is_default,
            },
        )
        await self.session.flush()
        return StagedChatChannelCreate(
            channel=channel,
            actor_user_id=user_id,
            initial_member_ids=tuple(initial_member_ids),
            tag_ids=tuple(tag_ids) if tag_ids is not None else None,
        )

    async def finish_channel_create_after_commit(self, staged: StagedChatChannelCreate) -> None:
        channel = staged.channel
        await self._sync_channel_tags(
            actor_id=staged.actor_user_id,
            channel=channel,
            tag_ids=list(staged.tag_ids) if staged.tag_ids is not None else None,
        )

        try:
            await self._index_for_search(channel)
        except Exception:
            logger.warning(f"Failed to index channel {channel.id}")

        await self._publish_channel_created(channel.id)
        await self._notify_membership_changed(
            channel,
            actor_user_id=staged.actor_user_id,
            target_user_ids=[
                member_id
                for member_id in staged.initial_member_ids
                if member_id != staged.actor_user_id
            ],
            added=True,
        )
