"""Chat thread operations."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.domains.chat.access import ChatAccessChecker


class ChatThreadOperations:
    """Thread operations: inbox, follow/unfollow, thread messages."""

    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def get_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID,
    ) -> tuple[ChatMessage, ChatThreadStats | None, list[UUID], bool]:
        """Get thread info: root message, stats, participants, is_following."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        # Fetch root message
        result = await self.session.execute(
            select(ChatMessage).where(
                ChatMessage.id == root_message_id,
                ChatMessage.channel_id == channel_id,
            )
        )
        root_msg = result.scalar_one_or_none()
        if not root_msg:
            raise NotFoundError("message", root_message_id)

        # Fetch thread stats
        stats_result = await self.session.execute(
            select(ChatThreadStats).where(
                ChatThreadStats.root_message_id == root_message_id
            )
        )
        stats = stats_result.scalar_one_or_none()

        # Fetch participants
        p_result = await self.session.execute(
            select(ChatThreadParticipant.user_id)
            .where(ChatThreadParticipant.root_message_id == root_message_id)
            .order_by(ChatThreadParticipant.created_at)
            .limit(10)
        )
        participant_ids = [r[0] for r in p_result.all()]

        # Check if user follows
        follow_result = await self.session.execute(
            select(ChatThreadFollow).where(
                ChatThreadFollow.root_message_id == root_message_id,
                ChatThreadFollow.user_id == user_id,
            )
        )
        is_following = follow_result.scalar_one_or_none() is not None

        return root_msg, stats, participant_ids, is_following

    async def get_thread_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID,
        before_id: UUID | None = None,
        after_id: UUID | None = None,
        limit: int = 50,
    ) -> tuple[list[ChatMessage], bool]:
        """Get messages in a thread (replies to root_message_id)."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        limit = min(max(limit, 1), 100)

        query = select(ChatMessage).where(
            ChatMessage.root_id == root_message_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        )

        if before_id:
            cursor_result = await self.session.execute(
                select(ChatMessage.created_at, ChatMessage.id).where(
                    ChatMessage.id == before_id
                )
            )
            cursor = cursor_result.one_or_none()
            if cursor:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id)
                    < (cursor[0], cursor[1])
                )
            query = query.order_by(
                ChatMessage.created_at.desc(), ChatMessage.id.desc()
            )
        elif after_id:
            cursor_result = await self.session.execute(
                select(ChatMessage.created_at, ChatMessage.id).where(
                    ChatMessage.id == after_id
                )
            )
            cursor = cursor_result.one_or_none()
            if cursor:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id)
                    > (cursor[0], cursor[1])
                )
            query = query.order_by(
                ChatMessage.created_at.asc(), ChatMessage.id.asc()
            )
        else:
            query = query.order_by(
                ChatMessage.created_at.desc(), ChatMessage.id.desc()
            )

        query = query.limit(limit + 1)
        result = await self.session.execute(query)
        messages = list(result.scalars().all())

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        if not after_id:
            messages.reverse()

        return messages, has_more

    async def get_threads_inbox(
        self,
        user_id: UUID,
        organization_id: UUID,
        unread_only: bool = False,
        limit: int = 20,
    ) -> list[tuple[ChatThread, ChatThreadStats, ChatMessage, ChatChannel]]:
        """Get threads the user is following, sorted by last_reply_at."""
        limit = min(max(limit, 1), 50)

        query = (
            select(ChatThread, ChatThreadStats, ChatMessage, ChatChannel)
            .join(
                ChatThreadFollow,
                ChatThreadFollow.root_message_id == ChatThread.root_message_id,
            )
            .join(
                ChatThreadStats,
                ChatThreadStats.root_message_id == ChatThread.root_message_id,
            )
            .join(
                ChatMessage,
                ChatMessage.id == ChatThread.root_message_id,
            )
            .join(
                ChatChannel,
                ChatChannel.id == ChatThread.channel_id,
            )
            .where(
                ChatThreadFollow.user_id == user_id,
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
            .order_by(ChatThreadStats.last_reply_at.desc().nullslast())
            .limit(limit)
        )

        result = await self.session.execute(query)
        return list(result.all())

    async def follow_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        root_message_id: UUID,
    ) -> None:
        """Follow a thread."""
        from datetime import UTC, datetime

        # Verify thread exists
        result = await self.session.execute(
            select(ChatThread).where(
                ChatThread.root_message_id == root_message_id
            )
        )
        thread = result.scalar_one_or_none()
        if not thread:
            raise NotFoundError("thread", root_message_id)

        await self.session.execute(
            pg_insert(ChatThreadFollow)
            .values(
                root_message_id=root_message_id,
                user_id=user_id,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(
                index_elements=["root_message_id", "user_id"]
            )
        )
        await self.session.commit()

    async def unfollow_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        root_message_id: UUID,
    ) -> None:
        """Unfollow a thread."""
        await self.session.execute(
            delete(ChatThreadFollow).where(
                ChatThreadFollow.root_message_id == root_message_id,
                ChatThreadFollow.user_id == user_id,
            )
        )
        await self.session.commit()
