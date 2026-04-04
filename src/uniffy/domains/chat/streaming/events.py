"""Chat event type constants and payload builders.

These constants match the ChatEventType proto enum values as strings
for the Valkey Pub/Sub `_type` field.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

# Channel-level event types
MESSAGE_CREATED = "message_created"
MESSAGE_UPDATED = "message_updated"
MESSAGE_DELETED = "message_deleted"
REACTION_ADDED = "reaction_added"
REACTION_REMOVED = "reaction_removed"
TYPING_STARTED = "typing_started"
TYPING_STOPPED = "typing_stopped"
MEMBER_JOINED = "member_joined"
MEMBER_LEFT = "member_left"
CHANNEL_UPDATED = "channel_updated"
THREAD_UPDATED = "thread_updated"

# User-level event types
UNREAD_COUNT_CHANGED = "unread_count_changed"
THREAD_ACTIVITY = "thread_activity"
MENTION_RECEIVED = "mention_received"


def build_message_payload(
    message_id: UUID,
    channel_id: UUID,
    sender_id: UUID,
    sender_type: str,
    content: str,
    root_id: UUID | None,
    created_at: datetime,
    sender_name: str = "",
    sender_avatar_url: str = "",
    is_pinned: bool = False,
    edited_at: datetime | None = None,
    metadata: dict | None = None,
    reply_to_id: UUID | None = None,
    reply_context: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a full message payload for MESSAGE_CREATED/UPDATED events."""
    payload: dict[str, Any] = {
        "message_id": str(message_id),
        "channel_id": str(channel_id),
        "sender_id": str(sender_id),
        "sender_type": sender_type,
        "content": content,
        "root_id": str(root_id) if root_id else None,
        "created_at": created_at.isoformat(),
        "is_pinned": is_pinned,
        "sender_name": sender_name,
        "sender_avatar_url": sender_avatar_url,
    }
    if edited_at:
        payload["edited_at"] = edited_at.isoformat()
    if metadata:
        payload["metadata"] = metadata
    if reply_to_id:
        payload["reply_to_id"] = str(reply_to_id)
    if reply_context:
        payload["reply_context"] = reply_context
    return payload


def build_message_deleted_payload(
    message_id: UUID,
    deleted_at: datetime,
) -> dict[str, Any]:
    """Build payload for MESSAGE_DELETED event."""
    return {
        "message_id": str(message_id),
        "deleted_at": deleted_at.isoformat(),
    }


def build_reaction_payload(
    message_id: UUID,
    emoji: str,
    user_id: UUID,
    display_name: str = "",
) -> dict[str, Any]:
    """Build payload for REACTION_ADDED/REMOVED events."""
    return {
        "message_id": str(message_id),
        "emoji": emoji,
        "user_id": str(user_id),
        "display_name": display_name,
    }


def build_typing_payload(
    user_id: UUID,
    display_name: str = "",
) -> dict[str, Any]:
    """Build payload for TYPING_STARTED event."""
    return {
        "user_id": str(user_id),
        "display_name": display_name,
    }


def build_member_payload(
    user_id: UUID,
    display_name: str = "",
    avatar_url: str = "",
    role: str = "MEMBER",
) -> dict[str, Any]:
    """Build payload for MEMBER_JOINED/LEFT events."""
    return {
        "user_id": str(user_id),
        "display_name": display_name,
        "avatar_url": avatar_url,
        "role": role,
    }


def build_thread_updated_payload(
    root_message_id: UUID,
    reply_count: int,
    last_reply_at: datetime,
    latest_participant_id: UUID,
) -> dict[str, Any]:
    """Build payload for THREAD_UPDATED event."""
    return {
        "root_message_id": str(root_message_id),
        "reply_count": reply_count,
        "last_reply_at": last_reply_at.isoformat(),
        "latest_participant_id": str(latest_participant_id),
    }
