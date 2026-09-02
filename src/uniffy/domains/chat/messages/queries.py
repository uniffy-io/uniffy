"""Focused chat message queries behavior."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.message import ChatMessage

logger = logger.bind(component="chat.messages.queries")


class MessageQueries:
    async def get_messages(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        before_id: UUID | None = None,
        after_id: UUID | None = None,
        around_id: UUID | None = None,
        limit: int = 50,
        root_only: bool = True,
    ) -> tuple[list[ChatMessage], bool]:
        """Cursor-paginated messages; around_id fetches limit/2 before + target + limit/2 after."""
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        limit = min(max(limit, 1), 100)

        if around_id:
            around = await self._get_messages_around(
                channel_id,
                around_id,
                limit,
                root_only,
            )
            if around is not None:
                return around
            # Target is gone or belongs elsewhere (stale search hit, old deep link);
            # the latest page beats handing back an empty channel.

        query = select(ChatMessage).where(
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        )

        if root_only:
            query = query.where(ChatMessage.root_id.is_(None))

        if before_id:
            cursor_msg = await self._get_message_by_id(before_id)
            if cursor_msg:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) < (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        elif after_id:
            cursor_msg = await self._get_message_by_id(after_id)
            if cursor_msg:
                query = query.where(
                    (ChatMessage.created_at, ChatMessage.id) > (cursor_msg.created_at, cursor_msg.id)
                )
            query = query.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        else:
            query = query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())

        # +1 to detect has_more.
        query = query.limit(limit + 1)
        result = await self.session.execute(query)
        messages = list(result.scalars().all())

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        # DESC fetches (before_id / latest) need a reverse.
        if not after_id:
            messages.reverse()

        return messages, has_more

    async def _get_messages_around(
        self,
        channel_id: UUID,
        target_id: UUID,
        limit: int,
        root_only: bool,
    ) -> tuple[list[ChatMessage], bool] | None:
        """None when the target cannot anchor a window, so the caller can serve the latest page."""
        target = await self._get_message_by_id(target_id)
        if not target or target.channel_id != channel_id or target.is_deleted:
            return None

        half = limit // 2
        base_where = [
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        ]
        if root_only:
            base_where.append(ChatMessage.root_id.is_(None))

        before_q = (
            select(ChatMessage)
            .where(
                *base_where,
                (ChatMessage.created_at, ChatMessage.id) < (target.created_at, target.id),
            )
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(half + 1)
        )
        before_result = await self.session.execute(before_q)
        before_msgs = list(before_result.scalars().all())

        # has_more reports the OLDER side, matching before_id pagination: clients page backwards
        # from a window, and a target near the tail would otherwise disable that.
        has_more = len(before_msgs) > half
        if has_more:
            before_msgs = before_msgs[:half]
        before_msgs.reverse()

        after_q = (
            select(ChatMessage)
            .where(
                *base_where,
                (ChatMessage.created_at, ChatMessage.id) > (target.created_at, target.id),
            )
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .limit(half)
        )
        after_result = await self.session.execute(after_q)
        after_msgs = list(after_result.scalars().all())

        return before_msgs + [target] + after_msgs, has_more

    async def get_message(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> ChatMessage:
        channel = await self.access.get_channel(channel_id, organization_id)
        await self.access.check_access(user_id, organization_id, channel)

        msg = await self._get_message_by_id(message_id)
        if not msg or msg.channel_id != channel_id:
            raise NotFoundError("message", message_id)
        return msg
