"""Chat event type constants and payload builders; strings match ChatEventType proto enum values."""

from datetime import datetime
from typing import Any
from uuid import UUID

MESSAGE_CREATED = "message_created"
MESSAGE_UPDATED = "message_updated"
MESSAGE_DELETED = "message_deleted"
REACTION_ADDED = "reaction_added"
REACTION_REMOVED = "reaction_removed"
TYPING_STARTED = "typing_started"
TYPING_STOPPED = "typing_stopped"
MEMBER_JOINED = "member_joined"
MEMBER_LEFT = "member_left"
MEMBER_UPDATED = "member_updated"
MEMBERS_ADDED = "members_added"
MEMBERS_REMOVED = "members_removed"
CHANNEL_UPDATED = "channel_updated"
THREAD_UPDATED = "thread_updated"

AGENT_TYPING = "agent_typing"
AGENT_TOKEN_DELTA = "agent_token_delta"
AGENT_THINKING_DELTA = "agent_thinking_delta"
AGENT_TOOL_CALL = "agent_tool_call"
AGENT_CONFIRMATION_REQUESTED = "agent_confirmation_requested"
AGENT_CONFIRMATION_RESOLVED = "agent_confirmation_resolved"

CALL_STARTED = "call_started"
CALL_ENDED = "call_ended"
CALL_PARTICIPANT_JOINED = "call_participant_joined"
CALL_PARTICIPANT_LEFT = "call_participant_left"
CALL_PARTICIPANT_STATE = "call_participant_state"
CALL_RING = "call_ring"
CALL_HOST_CHANGED = "call_host_changed"

UNREAD_COUNT_CHANGED = "unread_count_changed"
THREAD_ACTIVITY = "thread_activity"
MENTION_RECEIVED = "mention_received"
DRAFT_CHANGED = "draft_changed"


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
    """Single-user MEMBER_JOINED/LEFT payload; batch flows use build_members_changed_payload."""
    return {
        "user_id": str(user_id),
        "display_name": display_name,
        "avatar_url": avatar_url,
        "role": role,
    }


def build_members_changed_payload(user_ids: list[UUID]) -> dict[str, Any]:
    return {"user_ids": [str(uid) for uid in user_ids]}


def build_agent_typing_payload(
    agent_id: UUID,
    display_name: str = "",
    started: bool = True,
    root_id: UUID | None = None,
) -> dict[str, Any]:
    """root_id set when triggered by a thread reply so the indicator scopes to the thread panel."""
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
    return {
        "message_id": str(message_id),
        "agent_id": str(agent_id),
        "delta": delta,
        "sequence": sequence,
        "final": final,
    }


def build_agent_thinking_delta_payload(
    message_id: UUID,
    agent_id: UUID,
    block_id: str,
    delta: str,
    sequence: int,
    final: bool = False,
    elapsed_ms: int = 0,
) -> dict[str, Any]:
    """AGENT_THINKING_DELTA payload; `final=True` closes the block and
    carries the runtime-stamped thinking duration."""
    return {
        "message_id": str(message_id),
        "agent_id": str(agent_id),
        "block_id": block_id,
        "delta": delta,
        "sequence": sequence,
        "final": final,
        "elapsed_ms": elapsed_ms,
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
    """AGENT_TOOL_CALL payload; status is STARTED/COMPLETED/FAILED."""
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
    return {
        "message_id": str(message_id),
        "request_id": str(request_id),
        "decision": decision,
        "decided_by_user_id": str(decided_by_user_id),
        "decided_at": decided_at.isoformat(),
    }


def build_call_lifecycle_payload(call: dict[str, Any]) -> dict[str, Any]:
    """CALL_STARTED / CALL_ENDED; `call` is the snapshot dict from calls converters."""
    return {"call": call}


def build_call_participant_payload(
    call_id: UUID,
    participant: dict[str, Any],
    active_participant_count: int,
) -> dict[str, Any]:
    return {
        "call_id": str(call_id),
        "participant": participant,
        "active_participant_count": active_participant_count,
    }


def build_call_ring_payload(
    call_id: UUID,
    channel_name: str,
    call_type: str,
    caller_user_id: UUID,
    caller_name: str,
    caller_avatar_url: str | None,
    expires_at: datetime,
) -> dict[str, Any]:
    return {
        "call_id": str(call_id),
        "channel_name": channel_name,
        "call_type": call_type,
        "caller_user_id": str(caller_user_id),
        "caller_name": caller_name,
        "caller_avatar_url": caller_avatar_url or "",
        "expires_at": expires_at.isoformat(),
    }


def build_call_host_changed_payload(call_id: UUID, new_host_user_id: UUID) -> dict[str, Any]:
    return {
        "call_id": str(call_id),
        "new_host_user_id": str(new_host_user_id),
    }


def build_draft_changed_payload(
    channel_id: UUID,
    root_message_id: UUID | None,
    content: str,
    deleted: bool,
    updated_at: datetime,
    client_session_id: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "channel_id": str(channel_id),
        "content": content,
        "deleted": deleted,
        "updated_at": updated_at.isoformat(),
        "client_session_id": client_session_id,
    }
    if root_message_id is not None:
        payload["root_message_id"] = str(root_message_id)
    return payload


def build_thread_updated_payload(
    root_message_id: UUID,
    reply_count: int,
    last_reply_at: datetime,
    latest_participant_id: UUID,
) -> dict[str, Any]:
    return {
        "root_message_id": str(root_message_id),
        "reply_count": reply_count,
        "last_reply_at": last_reply_at.isoformat(),
        "latest_participant_id": str(latest_participant_id),
    }
