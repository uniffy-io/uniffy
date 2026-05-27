"""App-level cleanup for chat rows; replaces the CASCADE FKs dropped when chat went polymorphic."""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.thread import ChatThreadParticipant
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType


async def cleanup_chat_membership_for_deleted_user(session: AsyncSession, user_id: UUID) -> None:
    """Remove all chat membership rows for a deleted user; commit is caller-controlled."""
    await session.execute(
        delete(ChatChannelMember).where(
            ChatChannelMember.subject_type == SubjectType.USER,
            ChatChannelMember.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadParticipant).where(
            ChatThreadParticipant.subject_type == SubjectType.USER,
            ChatThreadParticipant.subject_id == user_id,
        )
    )
    await session.execute(
        delete(ChatThreadFollow).where(
            ChatThreadFollow.subject_type == SubjectType.USER,
            ChatThreadFollow.subject_id == user_id,
        )
    )
