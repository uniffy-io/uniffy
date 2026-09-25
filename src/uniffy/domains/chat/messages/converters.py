"""Proto <-> domain converters for chat messages."""

from contextlib import suppress
from datetime import datetime
from uuid import UUID

from uniffy_proto.chat.v1.chat_pb import (
    ChatMessage as ProtoChatMessage,
)
from uniffy_proto.chat.v1.chat_pb import (
    ChatMessageRevision as ProtoChatMessageRevision,
)
from uniffy_proto.chat.v1.chat_pb import (
    ForwardContext as ProtoForwardContext,
)
from uniffy_proto.chat.v1.chat_pb import (
    ForwardedAttachment as ProtoForwardedAttachment,
)
from uniffy_proto.chat.v1.chat_pb import (
    ReactionGroup as ProtoReactionGroup,
)
from uniffy_proto.chat.v1.chat_pb import (
    ReplyContext as ProtoReplyContext,
)
from uniffy_proto.chat.v1.chat_pb import (
    SenderType as ProtoSenderType,
)
from uniffy_proto.chat.v1.chat_pb import (
    ThreadInfo as ProtoThreadInfo,
)
from uniffy_proto.chat.v1.chat_pb import (
    ThreadReplyContext as ProtoThreadReplyContext,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKey, SenderType
from uniffy.core.models.chat.message_revision import ChatMessageRevision
from uniffy.core.models.chat.thread import ChatThreadStats

SENDER_TYPE_TO_PROTO = {
    SenderType.USER: ProtoSenderType.USER,
    SenderType.AGENT: ProtoSenderType.AGENT,
    SenderType.SYSTEM: ProtoSenderType.SYSTEM,
    SenderType.GUEST: ProtoSenderType.GUEST,
}


def get_forward_metadata(metadata: dict | None) -> dict | None:
    raw = (metadata or {}).get(ChatMessageMetadataKey.FORWARD.value)
    if not isinstance(raw, dict):
        return None
    if not isinstance(raw.get("snapshot"), dict):
        return None
    if not raw.get("message_id") or not raw.get("channel_id"):
        return None
    return raw


_PRIVATE_METADATA_KEYS = frozenset({
    ChatMessageMetadataKey.FORWARD.value,
    ChatMessageMetadataKey.THREAD_REPLY.value,
})


def public_message_metadata(metadata: dict | None) -> dict:
    """Metadata minus the keys that reach clients as typed contexts instead."""
    return {
        str(key): value
        for key, value in (metadata or {}).items()
        if str(key) not in _PRIVATE_METADATA_KEYS
    }


def get_thread_reply_metadata(metadata: dict | None) -> dict | None:
    raw = (metadata or {}).get(ChatMessageMetadataKey.THREAD_REPLY.value)
    if not isinstance(raw, dict):
        return None
    if not raw.get("root_message_id") or not raw.get("reply_message_id"):
        return None
    return raw


def thread_reply_context_to_proto(metadata: dict | None) -> ProtoThreadReplyContext | None:
    raw = get_thread_reply_metadata(metadata)
    if raw is None:
        return None
    return ProtoThreadReplyContext(
        root_message_id=str(raw["root_message_id"]),
        reply_message_id=str(raw["reply_message_id"]),
    )


def forward_context_to_proto(metadata: dict | None) -> ProtoForwardContext | None:
    raw = get_forward_metadata(metadata)
    if raw is None:
        return None
    snapshot = raw.get("snapshot")
    assert isinstance(snapshot, dict)

    sender_type = ProtoSenderType.UNSPECIFIED
    with suppress(KeyError, TypeError, ValueError):
        sender_type = SENDER_TYPE_TO_PROTO[SenderType(snapshot.get("sender_type"))]

    attachments: list[ProtoForwardedAttachment] = []
    raw_attachments = snapshot.get("attachments")
    if isinstance(raw_attachments, list):
        for item in raw_attachments:
            if not isinstance(item, dict):
                continue
            try:
                size_bytes = int(item.get("size_bytes", 0))
            except TypeError, ValueError:
                size_bytes = 0
            attachments.append(
                ProtoForwardedAttachment(
                    file_id=str(item.get("file_id", "")),
                    filename=str(item.get("filename", "")),
                    mime_type=str(item.get("mime_type", "")),
                    size_bytes=max(size_bytes, 0),
                )
            )

    proto = ProtoForwardContext(
        source_message_id=str(raw.get("message_id", "")),
        source_channel_id=str(raw.get("channel_id", "")),
        source_channel_name=str(raw.get("channel_name", "")),
        sender_id=str(snapshot.get("sender_id", "")),
        sender_type=sender_type,
        sender_name=str(snapshot.get("sender_name", "")),
        content=str(snapshot.get("content", "")),
        attachments=attachments,
    )
    created_at = snapshot.get("created_at")
    if isinstance(created_at, str):
        with suppress(ValueError):
            proto.created_at = datetime_to_timestamp(datetime.fromisoformat(created_at))
    return proto


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
    forward_context: ProtoForwardContext | None = None,
) -> ProtoChatMessage:
    proto = ProtoChatMessage(
        id=str(message.id),
        channel_id=str(message.channel_id),
        sender_id=str(message.sender_id),
        sender_type=SENDER_TYPE_TO_PROTO.get(message.sender_type, ProtoSenderType.USER),
        content=message.content,
        is_deleted=message.is_deleted,
        is_pinned=message.is_pinned,
        is_forwarded=get_forward_metadata(message.message_metadata) is not None,
    )

    if message.root_id:
        proto.root_id = str(message.root_id)
    if message.reply_to_id:
        proto.reply_to_id = str(message.reply_to_id)
    if reply_context_id:
        proto.reply_context = ProtoReplyContext(
            id=reply_context_id,
            sender_name=reply_context_sender_name or "",
            content_preview=reply_context_content_preview or "",
        )
    if message.edited_at:
        proto.edited_at = datetime_to_timestamp(message.edited_at)
    if message.message_metadata:
        # The proto metadata map is string-valued; structured values must
        # cross as JSON (str() would emit Python repr, unparseable client-side).
        for k, v in public_message_metadata(message.message_metadata).items():
            proto.metadata[k] = dumps_str(v) if isinstance(v, (dict, list)) else str(v)
    if forward_context is not None:
        proto.forward_context = forward_context
    thread_reply_context = thread_reply_context_to_proto(message.message_metadata)
    if thread_reply_context is not None:
        proto.thread_reply_context = thread_reply_context
    if message.created_at:
        proto.created_at = datetime_to_timestamp(message.created_at)

    if thread_stats and message.root_id is None:
        thread_info = ProtoThreadInfo(
            reply_count=thread_stats.reply_count,
            has_unread=thread_has_unread,
        )
        if thread_stats.last_reply_at:
            thread_info.last_reply_at = datetime_to_timestamp(thread_stats.last_reply_at)
        if thread_participant_ids:
            thread_info.participant_ids.extend(str(uid) for uid in thread_participant_ids)
        proto.thread = thread_info

    if reactions:
        proto.reactions.extend(reactions)

    if sender_name:
        proto.sender_name = sender_name
    if sender_avatar_url:
        proto.sender_avatar_url = sender_avatar_url

    return proto


def revision_to_proto(revision: ChatMessageRevision) -> ProtoChatMessageRevision:
    proto = ProtoChatMessageRevision(
        revision_no=revision.revision_no,
        content=revision.content,
        edited_by=str(revision.edited_by),
    )
    proto.edited_at = datetime_to_timestamp(revision.edited_at)
    return proto
