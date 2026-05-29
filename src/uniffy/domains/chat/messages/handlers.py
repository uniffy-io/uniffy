"""Chat message RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.chat.v1.chat_pb2 import (
    DeleteMessageRequest,
    DeleteMessageResponse,
    GetMessageRequest,
    GetMessageResponse,
    GetMessagesRequest,
    GetMessagesResponse,
    GetPinnedMessagesRequest,
    GetPinnedMessagesResponse,
    PinMessageRequest,
    PinMessageResponse,
    SendMessageRequest,
    SendMessageResponse,
    UnpinMessageRequest,
    UnpinMessageResponse,
    UpdateMessageRequest,
    UpdateMessageResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_sender_info_from_context, get_user_id_from_context
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.converters import message_to_proto
from uniffy.domains.chat.messages.operations import ChatMessageOperations


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class MessageHandlers:
    async def send_message(
        self,
        request: SendMessageRequest,
        ctx: RequestContext,
    ) -> SendMessageResponse:
        user_id = get_user_id_from_context(ctx)
        jwt_name, jwt_avatar = get_sender_info_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        root_id = None
        if request.HasField("root_id"):
            try:
                root_id = UUID(request.root_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid root_id")

        reply_to_id = None
        if request.HasField("reply_to_id"):
            try:
                reply_to_id = UUID(request.reply_to_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid reply_to_id")

        metadata = dict(request.metadata) if request.metadata else None

        attachment_file_ids: list[UUID] = []
        for raw in request.attachment_file_ids:
            try:
                attachment_file_ids.append(UUID(raw))
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid attachment_file_id")

        try:
            async with open_session() as session:
                access = ChatAccessChecker(session)
                ops = ChatMessageOperations(session, access)
                message, sender_name, sender_avatar = await ops.send_message(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    content=request.content,
                    root_id=root_id,
                    reply_to_id=reply_to_id,
                    message_metadata=metadata,
                    sender_name=jwt_name,
                    sender_avatar=jwt_avatar,
                    attachment_file_ids=attachment_file_ids,
                )

                return SendMessageResponse(
                    message=message_to_proto(
                        message,
                        sender_name=sender_name,
                        sender_avatar_url=sender_avatar,
                    )
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def get_messages(
        self,
        request: GetMessagesRequest,
        ctx: RequestContext,
    ) -> GetMessagesResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        before_id = None
        after_id = None
        around_id = None
        if request.HasField("before_id"):
            before_id = UUID(request.before_id)
        if request.HasField("after_id"):
            after_id = UUID(request.after_id)
        if request.HasField("around_id"):
            around_id = UUID(request.around_id)

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                messages, has_more = await ops.get_messages(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    before_id=before_id,
                    after_id=after_id,
                    around_id=around_id,
                    limit=request.limit or 50,
                    root_only=request.root_only,
                )

                proto_messages = await self._enrich_messages(session, messages, user_id)

                return GetMessagesResponse(
                    messages=proto_messages,
                    has_more=has_more,
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_message(
        self,
        request: GetMessageRequest,
        ctx: RequestContext,
    ) -> GetMessageResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                msg = await ops.get_message(user_id, org_id, channel_id, message_id)
                return GetMessageResponse(message=message_to_proto(msg))
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def update_message(
        self,
        request: UpdateMessageRequest,
        ctx: RequestContext,
    ) -> UpdateMessageResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                msg = await ops.update_message(
                    user_id, org_id, channel_id, message_id, request.content
                )
                return UpdateMessageResponse(message=message_to_proto(msg))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def delete_message(
        self,
        request: DeleteMessageRequest,
        ctx: RequestContext,
    ) -> DeleteMessageResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                await ops.delete_message(user_id, org_id, channel_id, message_id)
                return DeleteMessageResponse()
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def pin_message(
        self,
        request: PinMessageRequest,
        ctx: RequestContext,
    ) -> PinMessageResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                msg = await ops.pin_message(user_id, org_id, channel_id, message_id)
                return PinMessageResponse(message=message_to_proto(msg))
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def unpin_message(
        self,
        request: UnpinMessageRequest,
        ctx: RequestContext,
    ) -> UnpinMessageResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                msg = await ops.unpin_message(user_id, org_id, channel_id, message_id)
                return UnpinMessageResponse(message=message_to_proto(msg))
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_pinned_messages(
        self,
        request: GetPinnedMessagesRequest,
        ctx: RequestContext,
    ) -> GetPinnedMessagesResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatMessageOperations(session)
                messages = await ops.get_pinned_messages(user_id, org_id, channel_id)
                return GetPinnedMessagesResponse(messages=[message_to_proto(m) for m in messages])
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def _enrich_messages(
        self,
        session: AsyncSession,
        messages: list,
        user_id: UUID,
    ) -> list:
        """Batch-enrich messages with thread stats, sender info, reactions, and reply context."""
        from collections import defaultdict

        from sqlalchemy import func, select

        from uniffy.core.models.chat.thread import ChatThreadParticipant, ChatThreadStats
        from uniffy.core.models.login.user import User
        from uniffy.domains.chat.reactions.operations import ChatReactionOperations

        if not messages:
            return []

        root_ids = [m.id for m in messages if m.root_id is None]
        message_ids = [m.id for m in messages]
        sender_ids = list({m.sender_id for m in messages})

        thread_stats_map: dict[UUID, ChatThreadStats] = {}
        thread_participants_map: dict[UUID, list[UUID]] = defaultdict(list)
        if root_ids:
            stats_result = await session.execute(
                select(ChatThreadStats).where(ChatThreadStats.root_message_id.in_(root_ids))
            )
            for ts in stats_result.scalars().all():
                thread_stats_map[ts.root_message_id] = ts

            # First 4 participants per thread in one query (window function).
            if thread_stats_map:
                thread_ids = list(thread_stats_map.keys())
                rn = (
                    func
                    .row_number()
                    .over(
                        partition_by=ChatThreadParticipant.root_message_id,
                        order_by=ChatThreadParticipant.created_at,
                    )
                    .label("rn")
                )
                sub = (
                    select(
                        ChatThreadParticipant.root_message_id,
                        ChatThreadParticipant.user_id,
                        rn,
                    )
                    .where(ChatThreadParticipant.root_message_id.in_(thread_ids))
                    .subquery()
                )
                p_result = await session.execute(
                    select(sub.c.root_message_id, sub.c.user_id)
                    .where(sub.c.rn <= 4)
                    .order_by(sub.c.root_message_id, sub.c.rn)
                )
                for row in p_result.all():
                    thread_participants_map[row[0]].append(row[1])

        sender_map: dict[UUID, tuple[str, str | None]] = {}
        if sender_ids:
            u_result = await session.execute(
                select(User.id, User.full_name, User.avatar_key).where(User.id.in_(sender_ids))
            )
            for row in u_result.all():
                sender_map[row[0]] = (row[1] or "Unknown", row[2])

        reply_to_ids = [m.reply_to_id for m in messages if m.reply_to_id]
        reply_context_map: dict[UUID, tuple[str, str, str]] = {}
        if reply_to_ids:
            from uniffy.core.models.chat.message import ChatMessage as ChatMessageModel

            rto_result = await session.execute(
                select(
                    ChatMessageModel.id, ChatMessageModel.sender_id, ChatMessageModel.content
                ).where(ChatMessageModel.id.in_(reply_to_ids))
            )
            rto_data = {row[0]: (row[1], row[2]) for row in rto_result.all()}
            missing_sender_ids = [sid for sid, _ in rto_data.values() if sid not in sender_map]
            if missing_sender_ids:
                extra_result = await session.execute(
                    select(User.id, User.full_name).where(User.id.in_(missing_sender_ids))
                )
                for row in extra_result.all():
                    sender_map[row[0]] = (row[1] or "Unknown", None)
            for rid, (sid, content) in rto_data.items():
                s_name = sender_map.get(sid, ("Unknown", None))[0]
                reply_context_map[rid] = (str(rid), s_name, content[:150])

        from uniffy_proto.chat.v1.chat_pb2 import ReactionGroup as ProtoReactionGroup

        reaction_ops = ChatReactionOperations(session)
        reactions_map = await reaction_ops.get_reactions_for_messages(message_ids, user_id)

        thread_unread_map: dict[UUID, bool] = {}
        if thread_stats_map:
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            read_ops = ChatReadStateOperations(session)
            thread_cursors = await read_ops.batch_get_thread_read_cursors(
                user_id,
                list(thread_stats_map.keys()),
            )
            for tid, ts in thread_stats_map.items():
                cursor_time = thread_cursors.get(tid)
                if cursor_time is None:
                    # Never opened: has unread if any replies exist.
                    thread_unread_map[tid] = ts.reply_count > 0
                elif ts.last_reply_at and ts.last_reply_at > cursor_time:
                    thread_unread_map[tid] = True
                else:
                    thread_unread_map[tid] = False

        proto_messages = []
        for msg in messages:
            ts = thread_stats_map.get(msg.id)
            participants = thread_participants_map.get(msg.id)
            sender = sender_map.get(msg.sender_id, ("Unknown", None))

            msg_reactions = reactions_map.get(msg.id)
            proto_reactions = None
            if msg_reactions:
                proto_reactions = [
                    ProtoReactionGroup(
                        emoji=r["emoji"],
                        count=r["count"],
                        current_user_reacted=r["current_user_reacted"],
                    )
                    for r in msg_reactions
                ]

            rc = reply_context_map.get(msg.reply_to_id) if msg.reply_to_id else None

            proto_messages.append(
                message_to_proto(
                    msg,
                    thread_stats=ts,
                    thread_participant_ids=participants,
                    thread_has_unread=thread_unread_map.get(msg.id, False),
                    sender_name=sender[0],
                    sender_avatar_url=sender[1],
                    reactions=proto_reactions,
                    reply_context_id=rc[0] if rc else None,
                    reply_context_sender_name=rc[1] if rc else None,
                    reply_context_content_preview=rc[2] if rc else None,
                )
            )

        return proto_messages
