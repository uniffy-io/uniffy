"""Chat thread RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.chat.v1.chat_pb2 import (
    FollowThreadRequest,
    FollowThreadResponse,
    GetThreadMessagesRequest,
    GetThreadMessagesResponse,
    GetThreadRequest,
    GetThreadResponse,
    GetThreadsInboxRequest,
    GetThreadsInboxResponse,
    ThreadInboxItem,
    UnfollowThreadRequest,
    UnfollowThreadResponse,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.user import User
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.messages.converters import message_to_proto
from uniffy.domains.chat.threads.operations import ChatThreadOperations


def _handle_error(e: Exception) -> None:
    """Map domain errors to ConnectRPC errors."""
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


async def _get_sender_info(
    session: AsyncSession,
    sender_id: UUID,
) -> tuple[str, str | None]:
    """Fetch display name and avatar for a single sender."""
    result = await session.execute(
        select(User.full_name, User.avatar_key).where(User.id == sender_id)
    )
    row = result.one_or_none()
    if row:
        return (row[0] or "Unknown", row[1])
    return ("Unknown", None)


async def _batch_get_sender_info(
    session: AsyncSession,
    sender_ids: list[UUID],
) -> dict[UUID, tuple[str, str | None]]:
    """Batch fetch display names and avatars for multiple senders."""
    if not sender_ids:
        return {}
    unique_ids = list(set(sender_ids))
    result = await session.execute(
        select(User.id, User.full_name, User.avatar_key).where(
            User.id.in_(unique_ids)
        )
    )
    return {row[0]: (row[1] or "Unknown", row[2]) for row in result.all()}


class ThreadHandlers:
    """Thread RPC handlers."""

    async def get_thread(
        self,
        request: GetThreadRequest,
        ctx: RequestContext,
    ) -> GetThreadResponse:
        """Get thread metadata."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatThreadOperations(session)
                root_msg, stats, participants, is_following = (
                    await ops.get_thread(
                        user_id, org_id, channel_id, root_id
                    )
                )

                sender_name, sender_avatar = await _get_sender_info(
                    session, root_msg.sender_id
                )
                resp = GetThreadResponse(
                    root_message=message_to_proto(
                        root_msg,
                        sender_name=sender_name,
                        sender_avatar_url=sender_avatar,
                    ),
                    reply_count=stats.reply_count if stats else 0,
                    participant_ids=[str(p) for p in participants],
                    is_following=is_following,
                )
                if stats and stats.last_reply_at:
                    resp.last_reply_at.CopyFrom(
                        datetime_to_timestamp(stats.last_reply_at)
                    )
                return resp
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_thread_messages(
        self,
        request: GetThreadMessagesRequest,
        ctx: RequestContext,
    ) -> GetThreadMessagesResponse:
        """Get messages in a thread."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        before_id = None
        after_id = None
        if request.HasField("before_id"):
            before_id = UUID(request.before_id)
        if request.HasField("after_id"):
            after_id = UUID(request.after_id)

        try:
            async for session in get_async_session():
                ops = ChatThreadOperations(session)
                messages, has_more = await ops.get_thread_messages(
                    user_id, org_id, channel_id, root_id,
                    before_id=before_id,
                    after_id=after_id,
                    limit=request.limit or 50,
                )

                sender_map = await _batch_get_sender_info(
                    session, [m.sender_id for m in messages]
                )
                return GetThreadMessagesResponse(
                    messages=[
                        message_to_proto(
                            m,
                            sender_name=sender_map.get(m.sender_id, ("Unknown", None))[0],
                            sender_avatar_url=sender_map.get(m.sender_id, ("Unknown", None))[1],
                        )
                        for m in messages
                    ],
                    has_more=has_more,
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_threads_inbox(
        self,
        request: GetThreadsInboxRequest,
        ctx: RequestContext,
    ) -> GetThreadsInboxResponse:
        """Get threads inbox (followed threads)."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = ChatThreadOperations(session)
                rows = await ops.get_threads_inbox(
                    user_id, org_id,
                    unread_only=request.unread_only,
                    limit=request.limit or 20,
                )

                # Batch fetch sender info for all root messages
                inbox_sender_ids = list({root_msg.sender_id for _, _, root_msg, _ in rows})
                inbox_sender_map = await _batch_get_sender_info(session, inbox_sender_ids)

                items = []
                for thread, stats, root_msg, channel in rows:
                    s = inbox_sender_map.get(root_msg.sender_id, ("Unknown", None))
                    item = ThreadInboxItem(
                        root_message_id=str(thread.root_message_id),
                        channel_id=str(thread.channel_id),
                        channel_name=channel.name,
                        root_message=message_to_proto(
                            root_msg,
                            sender_name=s[0],
                            sender_avatar_url=s[1],
                        ),
                        reply_count=stats.reply_count,
                    )
                    if stats.last_reply_at:
                        item.last_reply_at.CopyFrom(
                            datetime_to_timestamp(stats.last_reply_at)
                        )
                    items.append(item)

                return GetThreadsInboxResponse(
                    threads=items,
                    has_more=len(items) >= (request.limit or 20),
                )
        except Exception as e:
            _handle_error(e)

    async def follow_thread(
        self,
        request: FollowThreadRequest,
        ctx: RequestContext,
    ) -> FollowThreadResponse:
        """Follow a thread."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatThreadOperations(session)
                await ops.follow_thread(user_id, org_id, root_id)
                return FollowThreadResponse()
        except NotFoundError as e:
            _handle_error(e)

    async def unfollow_thread(
        self,
        request: UnfollowThreadRequest,
        ctx: RequestContext,
    ) -> UnfollowThreadResponse:
        """Unfollow a thread."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        async for session in get_async_session():
            ops = ChatThreadOperations(session)
            await ops.unfollow_thread(user_id, org_id, root_id)
            return UnfollowThreadResponse()
