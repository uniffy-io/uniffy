"""Thread reply accounting shared by chat message writers."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType

AGENT_THREAD_REPLY_KINDS = frozenset({
    ChatMessageMetadataKind.FINAL,
    ChatMessageMetadataKind.AGENT_ERROR,
    ChatMessageMetadataKind.SKILL_DRAFT,
})


def counts_as_thread_reply(message: ChatMessage) -> bool:
    """Whether a row moves its thread's reply counter."""
    if message.root_id is None:
        return False
    if message.sender_type != SenderType.AGENT:
        return True
    return (message.message_metadata or {}).get("kind") in AGENT_THREAD_REPLY_KINDS


async def record_thread_reply(
    session: AsyncSession,
    *,
    root_message_id: UUID,
    channel_id: UUID,
    sender_type: SenderType,
    sender_id: UUID,
    at: datetime,
    root_message: ChatMessage | None = None,
) -> None:
    """Count one reply into a thread and record its sender as a participant.

    Agents participate as AGENT subjects with no `user_id`, so the follow rows -
    a user-inbox concept - are written for human senders only. Caller owns the
    commit.
    """
    is_agent = sender_type == SenderType.AGENT
    subject_type = SubjectType.AGENT if is_agent else SubjectType.USER

    result = await session.execute(
        select(ChatThread).where(ChatThread.root_message_id == root_message_id)
    )
    thread = result.scalar_one_or_none()

    if not thread:
        session.add(
            ChatThread(
                root_message_id=root_message_id,
                channel_id=channel_id,
                created_at=at,
            )
        )
        await session.flush()
        session.add(
            ChatThreadStats(
                root_message_id=root_message_id,
                reply_count=1,
                last_reply_at=at,
            )
        )

        if (
            root_message is not None
            and root_message.sender_id != sender_id
            and root_message.sender_type == SenderType.USER
        ):
            session.add(
                ChatThreadFollow(
                    root_message_id=root_message_id,
                    subject_type=SubjectType.USER,
                    subject_id=root_message.sender_id,
                    user_id=root_message.sender_id,
                    created_at=at,
                )
            )
    else:
        await session.execute(
            update(ChatThreadStats)
            .where(ChatThreadStats.root_message_id == root_message_id)
            .values(
                reply_count=ChatThreadStats.reply_count + 1,
                last_reply_at=at,
            )
        )

    await session.execute(
        pg_insert(ChatThreadParticipant)
        .values(
            root_message_id=root_message_id,
            subject_type=subject_type,
            subject_id=sender_id,
            user_id=None if is_agent else sender_id,
            created_at=at,
        )
        .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
    )

    if is_agent:
        return

    await session.execute(
        pg_insert(ChatThreadFollow)
        .values(
            root_message_id=root_message_id,
            subject_type=SubjectType.USER,
            subject_id=sender_id,
            user_id=sender_id,
            created_at=at,
        )
        .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
    )


async def drop_thread_reply(session: AsyncSession, root_message_id: UUID) -> None:
    """Take one counted reply back off a thread (deletion, discarded placeholder).

    Participant rows are append-only, so only the counter moves. Caller owns the
    commit.
    """
    await session.execute(
        update(ChatThreadStats)
        .where(
            ChatThreadStats.root_message_id == root_message_id,
            ChatThreadStats.reply_count > 0,
        )
        .values(reply_count=ChatThreadStats.reply_count - 1)
    )
