"""Chat thread RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatMessage as ProtoChatMessage,
)
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

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.agents.message_feedback import AgentMessageFeedback
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.converters import SENDER_TYPE_TO_PROTO, message_to_proto
from uniffy.domains.chat.messages.projection import ForwardProjectionResolver
from uniffy.domains.chat.senders import SenderResolver
from uniffy.domains.chat.threads.operations import ChatThreadOperations, ThreadInboxRow
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="chat.threads.handlers")


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


def _sender_ref(msg: ChatMessage) -> tuple[SenderType, UUID]:
    return (msg.sender_type, msg.sender_id)


class ThreadHandlers:
    async def get_thread(
        self,
        request: GetThreadRequest,
        ctx: RequestContext,
    ) -> GetThreadResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            channel_id = UUID(request.channel_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                access = ChatAccessChecker(session)
                ops = ChatThreadOperations(session, access)
                (
                    root_msg,
                    stats,
                    participants,
                    total_participants,
                    is_following,
                ) = await ops.get_thread(user_id, org_id, channel_id, root_id)

                resolver = SenderResolver(session)
                info = await resolver.resolve_one(root_msg.sender_type, root_msg.sender_id)
                forward_contexts = await ForwardProjectionResolver(session, access).resolve(
                    user_id=user_id,
                    organization_id=org_id,
                    messages=[root_msg],
                )
                resp = GetThreadResponse(
                    root_message=message_to_proto(
                        root_msg,
                        sender_name=info.display_name,
                        sender_avatar_url=info.avatar_url or None,
                        forward_context=forward_contexts.get(root_msg.id),
                    ),
                    reply_count=stats.reply_count if stats else 0,
                    participant_ids=[str(p) for p in participants],
                    total_participants=total_participants,
                    is_following=is_following,
                )
                if stats and stats.last_reply_at:
                    resp.last_reply_at.CopyFrom(datetime_to_timestamp(stats.last_reply_at))
                return resp
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_thread_messages(
        self,
        request: GetThreadMessagesRequest,
        ctx: RequestContext,
    ) -> GetThreadMessagesResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
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
            async with open_session() as session:
                access = ChatAccessChecker(session)
                ops = ChatThreadOperations(session, access)
                messages, has_more = await ops.get_thread_messages(
                    user_id,
                    org_id,
                    channel_id,
                    root_id,
                    before_id=before_id,
                    after_id=after_id,
                    limit=request.limit or 50,
                )

                resolver = SenderResolver(session)
                sender_map = await resolver.resolve_many([_sender_ref(m) for m in messages])
                forward_contexts = await ForwardProjectionResolver(session, access).resolve(
                    user_id=user_id,
                    organization_id=org_id,
                    messages=messages,
                )

                feedback_map: dict[UUID, str] = {}
                agent_ids = [m.id for m in messages if m.sender_type == SenderType.AGENT]
                if agent_ids:
                    fb_result = await session.execute(
                        select(
                            AgentMessageFeedback.chat_message_id,
                            AgentMessageFeedback.rating,
                        ).where(
                            AgentMessageFeedback.user_id == user_id,
                            AgentMessageFeedback.chat_message_id.in_(agent_ids),
                        )
                    )
                    feedback_map = {mid: rating for mid, rating in fb_result.all()}

                proto_messages = []
                for m in messages:
                    proto_msg = message_to_proto(
                        m,
                        sender_name=(
                            sender_map[m.sender_id].display_name
                            if m.sender_id in sender_map
                            else "Unknown"
                        ),
                        sender_avatar_url=(
                            sender_map[m.sender_id].avatar_url or None
                            if m.sender_id in sender_map
                            else None
                        ),
                        forward_context=forward_contexts.get(m.id),
                    )
                    rating = feedback_map.get(m.id)
                    if rating:
                        proto_msg.feedback_rating = rating
                    proto_messages.append(proto_msg)

                return GetThreadMessagesResponse(
                    messages=proto_messages,
                    has_more=has_more,
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def get_threads_inbox(
        self,
        request: GetThreadsInboxRequest,
        ctx: RequestContext,
    ) -> GetThreadsInboxResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = ChatThreadOperations(session)
                rows = await ops.get_threads_inbox(
                    user_id,
                    org_id,
                    unread_only=request.unread_only,
                    limit=request.limit or 20,
                )

                resolver = SenderResolver(session)
                inbox_sender_map = await resolver.resolve_many([
                    (row.sender_type, row.sender_id) for row in rows
                ])

                items = [self._build_inbox_item(row, inbox_sender_map) for row in rows]

                return GetThreadsInboxResponse(
                    threads=items,
                    has_more=len(items) >= (request.limit or 20),
                )
        except Exception as e:
            _handle_error(e)

    @staticmethod
    def _build_inbox_item(row: ThreadInboxRow, sender_map: dict) -> ThreadInboxItem:
        """Build a ThreadInboxItem from preview-only columns to avoid full chat_messages fetch."""
        info = sender_map.get(row.sender_id)
        sender_name = info.display_name if info else "Unknown"
        sender_avatar = info.avatar_url if info else None

        root_proto = ProtoChatMessage(
            id=str(row.root_message_id),
            channel_id=str(row.thread.channel_id),
            sender_id=str(row.sender_id),
            sender_type=SENDER_TYPE_TO_PROTO.get(row.sender_type),
            content=row.content_preview,
            sender_name=sender_name,
        )
        if sender_avatar:
            root_proto.sender_avatar_url = sender_avatar
        if row.created_at:
            root_proto.created_at.CopyFrom(datetime_to_timestamp(row.created_at))

        item = ThreadInboxItem(
            root_message_id=str(row.thread.root_message_id),
            channel_id=str(row.thread.channel_id),
            channel_name=row.channel.name,
            root_message=root_proto,
            reply_count=row.stats.reply_count,
        )
        if row.stats.last_reply_at:
            item.last_reply_at.CopyFrom(datetime_to_timestamp(row.stats.last_reply_at))
        return item

    async def follow_thread(
        self,
        request: FollowThreadRequest,
        ctx: RequestContext,
    ) -> FollowThreadResponse:
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
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
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        async with open_session() as session:
            ops = ChatThreadOperations(session)
            await ops.unfollow_thread(user_id, org_id, root_id)
            return UnfollowThreadResponse()
