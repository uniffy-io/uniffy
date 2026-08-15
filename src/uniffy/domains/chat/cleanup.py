"""Organization-scoped cleanup for polymorphic chat membership rows."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType
from uniffy.domains.chat.search_acl import record_chat_search_acl_refresh


@dataclass(frozen=True)
class ChatMembershipCleanup:
    channel_ids: tuple[UUID, ...]
    private_channel_ids: tuple[UUID, ...]


async def cleanup_chat_membership_for_organization(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> ChatMembershipCleanup:
    rows = (
        await session.execute(
            select(ChatChannel.id, ChatChannel.channel_type)
            .join(
                ChatChannelMember,
                ChatChannelMember.channel_id == ChatChannel.id,
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == user_id,
            )
        )
    ).all()
    channel_ids = tuple(channel_id for channel_id, _channel_type in rows)
    private_channel_ids = tuple(
        channel_id for channel_id, channel_type in rows if channel_type != ChannelType.PUBLIC
    )
    if not channel_ids:
        return ChatMembershipCleanup((), ())

    thread_ids = select(ChatThread.root_message_id).where(ChatThread.channel_id.in_(channel_ids))
    await session.execute(
        delete(ChatChannelMember).where(
            ChatChannelMember.channel_id.in_(channel_ids),
            ChatChannelMember.subject_type == SubjectType.USER,
            ChatChannelMember.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadParticipant).where(
            ChatThreadParticipant.root_message_id.in_(thread_ids),
            ChatThreadParticipant.subject_type == SubjectType.USER,
            ChatThreadParticipant.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadFollow).where(
            ChatThreadFollow.root_message_id.in_(thread_ids),
            ChatThreadFollow.subject_type == SubjectType.USER,
            ChatThreadFollow.subject_id == user_id,
        )
    )
    await session.execute(
        update(ChatChannelStats)
        .where(ChatChannelStats.channel_id.in_(channel_ids))
        .values(member_count=func.greatest(ChatChannelStats.member_count - 1, 0))
    )
    for channel_id in private_channel_ids:
        await record_chat_search_acl_refresh(
            session,
            organization_id=organization_id,
            channel_id=channel_id,
        )

    return ChatMembershipCleanup(channel_ids, private_channel_ids)
