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
MEMBERS_ADDED = "members_added"
MEMBERS_REMOVED = "members_removed"
CHANNEL_UPDATED = "channel_updated"
THREAD_UPDATED = "thread_updated"

# Agent runtime event types (Phase 2).
AGENT_TYPING = "agent_typing"
AGENT_TOKEN_DELTA = "agent_token_delta"
AGENT_TOOL_CALL = "agent_tool_call"
AGENT_CONFIRMATION_REQUESTED = "agent_confirmation_requested"
AGENT_CONFIRMATION_RESOLVED = "agent_confirmation_resolved"

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
    """Build payload for MEMBER_JOINED/LEFT events (single-user flows)."""
    return {
        "user_id": str(user_id),
        "display_name": display_name,
        "avatar_url": avatar_url,
        "role": role,
    }


def build_members_changed_payload(user_ids: list[UUID]) -> dict[str, Any]:
    """Build payload for batched MEMBERS_ADDED / MEMBERS_REMOVED."""
    return {"user_ids": [str(uid) for uid in user_ids]}


def build_agent_typing_payload(
    agent_id: UUID,
    display_name: str = "",
    started: bool = True,
    root_id: UUID | None = None,
) -> dict[str, Any]:
    """Build payload for AGENT_TYPING.

    `root_id` is set when the trigger was a thread reply so the frontend
    can scope the typing indicator to the thread panel instead of the
    channel root.
    """
    payload: dict[str, Any] = {
        "agent_id": str(agent_id),
        "display_name": display_name,
        "started": started,
    }
    if root_id is not None:
        payload["root_id"] = str(root_id)
    return payload


def build_agent_token_delta_payload(
    message_id: UUID,
    agent_id: UUID,
    delta: str,
    sequence: int,
    final: bool = False,
) -> dict[str, Any]:
    """Build payload for AGENT_TOKEN_DELTA."""
    return {
        "message_id": str(message_id),
        "agent_id": str(agent_id),
        "delta": delta,
        "sequence": sequence,
        "final": final,
    }


def build_agent_tool_call_payload(
    message_id: UUID,
    agent_id: UUID,
    tool_name: str,
    tool_call_id: str,
    status: str,
    preview: str | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    """Build payload for AGENT_TOOL_CALL. `status` is STARTED/COMPLETED/FAILED."""
    payload: dict[str, Any] = {
        "message_id": str(message_id),
        "agent_id": str(agent_id),
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "status": status,
    }
    if preview is not None:
        payload["preview"] = preview
    if error_message is not None:
        payload["error_message"] = error_message
    return payload


def build_agent_confirmation_requested_payload(
    message_id: UUID,
    agent_id: UUID,
    request_id: UUID,
    tool_name: str,
    args_preview: str,
    actor_user_id: UUID,
    expires_at: datetime,
) -> dict[str, Any]:
    """Build payload for AGENT_CONFIRMATION_REQUESTED."""
    return {
        "message_id": str(message_id),
        "agent_id": str(agent_id),
        "request_id": str(request_id),
        "tool_name": tool_name,
        "args_preview": args_preview,
        "actor_user_id": str(actor_user_id),
        "expires_at": expires_at.isoformat(),
    }


def build_agent_confirmation_resolved_payload(
    message_id: UUID,
    request_id: UUID,
    decision: str,
    decided_by_user_id: UUID,
    decided_at: datetime,
) -> dict[str, Any]:
    """Build payload for AGENT_CONFIRMATION_RESOLVED."""
    return {
        "message_id": str(message_id),
        "request_id": str(request_id),
        "decision": decision,
        "decided_by_user_id": str(decided_by_user_id),
        "decided_at": decided_at.isoformat(),
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
