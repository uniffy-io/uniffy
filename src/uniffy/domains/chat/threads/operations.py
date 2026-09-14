"""Chat thread operations."""

from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType
from uniffy.domains.chat.access import ChatAccessChecker

THREAD_PARTICIPANT_PREVIEW_LIMIT = 20
THREAD_INBOX_CONTENT_PREVIEW_CHARS = 200


class ThreadInboxRow:
    """Preview-only row; content trimmed at SQL level to avoid TOAST detoast on the inbox path."""

    __slots__ = (
        "thread",
        "stats",
        "root_message_id",
        "sender_id",
        "sender_type",
        "created_at",
        "content_preview",
        "channel",
    )

    def __init__(
        self,
        thread: ChatThread,
        stats: ChatThreadStats,
        root_message_id: UUID,
        sender_id: UUID,
        sender_type,
        created_at,
        content_preview: str,
        channel: ChatChannel,
    ) -> None:
        self.thread = thread
        self.stats = stats
        self.root_message_id = root_message_id
        self.sender_id = sender_id
        self.sender_type = sender_type
        self.created_at = created_at
        self.content_preview = content_preview
        self.channel = channel


class ChatThreadOperations:
    def __init__(self, session: AsyncSession, access: ChatAccessChecker | None = None) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)

    async def get_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        root_message_id: UUID,
    ) -> tuple[ChatMessage, ChatThreadStats | None, list[UUID], int, bool]:
        """Returns (root, stats, preview participants, total_participants, is_following)."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        result = await self.session.execute(
            select(ChatMessage).where(
                ChatMessage.id == root_message_id,
                ChatMessage.channel_id == channel_id,
            )
        )
        root_msg = result.scalar_one_or_none()
        if not root_msg:
            raise NotFoundError("message", root_message_id)
        if root_msg.root_id is not None:
            raise ValidationError("root_message_id", "Thread replies cannot start another thread")

        stats_result = await self.session.execute(
            select(ChatThreadStats).where(ChatThreadStats.root_message_id == root_message_id)
        )
        stats = stats_result.scalar_one_or_none()

        # subject_id, not user_id: agent participants carry no user row.
        p_result = await self.session.execute(
            select(ChatThreadParticipant.subject_id)
            .where(ChatThreadParticipant.root_message_id == root_message_id)
            .order_by(ChatThreadParticipant.created_at)
            .limit(THREAD_PARTICIPANT_PREVIEW_LIMIT)
        )
        participant_ids = [r[0] for r in p_result.all()]

        if len(participant_ids) < THREAD_PARTICIPANT_PREVIEW_LIMIT:
            total_participants = len(participant_ids)
        else:
            count_result = await self.session.execute(
                select(func.count())
                .select_from(ChatThreadParticipant)
                .where(ChatThreadParticipant.root_message_id == root_message_id)
            )
            total_participants = int(count_result.scalar_one() or 0)

        follow_result = await self.session.execute(
            select(ChatThreadFollow).where(
                ChatThreadFollow.root_message_id == root_message_id,
                ChatThreadFollow.user_id == user_id,
            )
        )
        is_following = follow_result.scalar_one_or_none() is not None

        return root_msg, stats, participant_ids, total_participants, is_following

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
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        root_result = await self.session.execute(
            select(ChatMessage.root_id).where(
                ChatMessage.id == root_message_id,
                ChatMessage.channel_id == channel_id,
            )
        )
        root = root_result.one_or_none()
        if root is None:
            raise NotFoundError("message", root_message_id)
        if root.root_id is not None:
            raise ValidationError("root_message_id", "Thread replies cannot start another thread")

        limit = min(max(limit, 1), 100)

        query = select(ChatMessage).where(
            ChatMessage.root_id == root_message_id,
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        )

        if before_id:
            cursor_result = await self.session.execute(
                select(ChatMessage.created_at, ChatMessage.id).where(ChatMessage.id == before_id)
            )
            cursor = cursor_result.one_or_none()
            if cursor:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) < (cursor[0], cursor[1])
                )
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        elif after_id:
            cursor_result = await self.session.execute(
                select(ChatMessage.created_at, ChatMessage.id).where(ChatMessage.id == after_id)
            )
            cursor = cursor_result.one_or_none()
            if cursor:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) > (cursor[0], cursor[1])
                )
            query = query.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        else:
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())

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
    ) -> list[ThreadInboxRow]:
        """Inbox of threads where the user follows, rooted, or replied; sorted by last_reply_at."""
        limit = min(max(limit, 1), 50)

        query = (
            select(
                ChatThread,
                ChatThreadStats,
                ChatMessage.id,
                ChatMessage.sender_id,
                ChatMessage.sender_type,
                ChatMessage.created_at,
                func.left(ChatMessage.content, THREAD_INBOX_CONTENT_PREVIEW_CHARS).label(
                    "content_preview"
                ),
                ChatChannel,
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
            .outerjoin(
                ChatThreadFollow,
                and_(
                    ChatThreadFollow.root_message_id == ChatThread.root_message_id,
                    ChatThreadFollow.user_id == user_id,
                ),
            )
            .outerjoin(
                ChatThreadParticipant,
                and_(
                    ChatThreadParticipant.root_message_id == ChatThread.root_message_id,
                    ChatThreadParticipant.subject_type == SubjectType.USER,
                    ChatThreadParticipant.subject_id == user_id,
                ),
            )
            .where(
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
                or_(
                    ChatThreadFollow.user_id.is_not(None),
                    ChatThreadParticipant.subject_id.is_not(None),
                    ChatMessage.sender_id == user_id,
                ),
            )
            .distinct()
            .order_by(ChatThreadStats.last_reply_at.desc().nullslast())
            .limit(limit)
        )

        result = await self.session.execute(query)
        return [
            ThreadInboxRow(
                thread=row[0],
                stats=row[1],
                root_message_id=row[2],
                sender_id=row[3],
                sender_type=row[4],
                created_at=row[5],
                content_preview=row[6] or "",
                channel=row[7],
            )
            for row in result.all()
        ]

    async def follow_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        root_message_id: UUID,
    ) -> None:
        from datetime import UTC, datetime

        result = await self.session.execute(
            select(ChatThread).where(ChatThread.root_message_id == root_message_id)
        )
        thread = result.scalar_one_or_none()
        if not thread:
            raise NotFoundError("thread", root_message_id)

        await self.session.execute(
            pg_insert(ChatThreadFollow)
            .values(
                root_message_id=root_message_id,
                subject_type=SubjectType.USER,
                subject_id=user_id,
                user_id=user_id,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=["root_message_id", "subject_type", "subject_id"])
        )
        await self.session.commit()

    async def unfollow_thread(
        self,
        user_id: UUID,
        organization_id: UUID,
        root_message_id: UUID,
    ) -> None:
        await self.session.execute(
            delete(ChatThreadFollow).where(
                ChatThreadFollow.root_message_id == root_message_id,
                ChatThreadFollow.user_id == user_id,
            )
        )
        await self.session.commit()
