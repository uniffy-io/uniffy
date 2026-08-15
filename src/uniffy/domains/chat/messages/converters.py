"""Proto <-> domain converters for chat messages."""

from uuid import UUID

from uniffy_proto.chat.v1.chat_pb2 import (
    ChatMessage as ProtoChatMessage,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ReactionGroup as ProtoReactionGroup,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ReplyContext as ProtoReplyContext,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    SenderType as ProtoSenderType,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ThreadInfo as ProtoThreadInfo,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThreadStats

SENDER_TYPE_TO_PROTO = {
    SenderType.USER: ProtoSenderType.SENDER_TYPE_USER,
    SenderType.AGENT: ProtoSenderType.SENDER_TYPE_AGENT,
    SenderType.SYSTEM: ProtoSenderType.SENDER_TYPE_SYSTEM,
    SenderType.GUEST: ProtoSenderType.SENDER_TYPE_GUEST,
}


def message_to_proto(
    message: ChatMessage,
    thread_stats: ChatThreadStats | None = None,
    thread_participant_ids: list[UUID] | None = None,
    thread_has_unread: bool = False,
    reactions: list[ProtoReactionGroup] | None = None,
    sender_name: str | None = None,
    sender_avatar_url: str | None = None,
    reply_context_id: str | None = None,
    reply_context_sender_name: str | None = None,
    reply_context_content_preview: str | None = None,
) -> ProtoChatMessage:
    proto = ProtoChatMessage(
        id=str(message.id),
        channel_id=str(message.channel_id),
        sender_id=str(message.sender_id),
        sender_type=SENDER_TYPE_TO_PROTO.get(message.sender_type, ProtoSenderType.SENDER_TYPE_USER),
        content=message.content,
        is_deleted=message.is_deleted,
        is_pinned=message.is_pinned,
    )

    if message.root_id:
        proto.root_id = str(message.root_id)
    if message.reply_to_id:
        proto.reply_to_id = str(message.reply_to_id)
    if reply_context_id:
        proto.reply_context.CopyFrom(
            ProtoReplyContext(
                id=reply_context_id,
                sender_name=reply_context_sender_name or "",
                content_preview=reply_context_content_preview or "",
            )
        )
    if message.edited_at:
        proto.edited_at.CopyFrom(datetime_to_timestamp(message.edited_at))
    if message.message_metadata:
        # The proto metadata map is string-valued; structured values must
        # cross as JSON (str() would emit Python repr, unparseable client-side).
        for k, v in message.message_metadata.items():
            proto.metadata[k] = dumps_str(v) if isinstance(v, (dict, list)) else str(v)
    if message.created_at:
        proto.created_at.CopyFrom(datetime_to_timestamp(message.created_at))

    if thread_stats and message.root_id is None:
        thread_info = ProtoThreadInfo(
            reply_count=thread_stats.reply_count,
            has_unread=thread_has_unread,
        )
        if thread_stats.last_reply_at:
            thread_info.last_reply_at.CopyFrom(datetime_to_timestamp(thread_stats.last_reply_at))
        if thread_participant_ids:
            thread_info.participant_ids.extend(str(uid) for uid in thread_participant_ids)
        proto.thread.CopyFrom(thread_info)

    if reactions:
        proto.reactions.extend(reactions)

    if sender_name:
        proto.sender_name = sender_name
    if sender_avatar_url:
        proto.sender_avatar_url = sender_avatar_url

    return proto
