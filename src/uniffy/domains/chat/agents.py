"""Chat capabilities used by the agents domain."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.domains.chat.messages.stats import bump_channel_message_stats
from uniffy.domains.chat.resources.operations import ChatResourceOperations
from uniffy.domains.chat.senders import SenderInfo, SenderResolver
from uniffy.domains.chat.streaming.events import (
    AGENT_CONFIRMATION_REQUESTED,
    AGENT_CONFIRMATION_RESOLVED,
    AGENT_THINKING_DELTA,
    AGENT_TOKEN_DELTA,
    AGENT_TOOL_CALL,
    AGENT_TYPING,
    MESSAGE_CREATED,
    MESSAGE_UPDATED,
    THREAD_UPDATED,
    build_agent_confirmation_requested_payload,
    build_agent_confirmation_resolved_payload,
    build_agent_thinking_delta_payload,
    build_agent_token_delta_payload,
    build_agent_tool_call_payload,
    build_agent_typing_payload,
    build_message_payload,
    build_thread_updated_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members
from uniffy.domains.chat.threads.replies import (
    AGENT_THREAD_REPLY_KINDS,
    counts_as_thread_reply,
    drop_thread_reply,
    record_thread_reply,
)

logger = logger.bind(component="chat.agents")


async def track_agent_message_resources(
    session: AsyncSession,
    channel_id: UUID,
    content: str,
    actor_user_id: UUID,
) -> None:
    try:
        await ChatResourceOperations(session).update_resources_from_message(
            channel_id,
            content,
            actor_user_id,
        )
    except Exception:
        logger.warning("Resource tracking failed for agent reply in channel {}", channel_id)


__all__ = [
    "AGENT_CONFIRMATION_REQUESTED",
    "AGENT_CONFIRMATION_RESOLVED",
    "AGENT_THINKING_DELTA",
    "AGENT_THREAD_REPLY_KINDS",
    "AGENT_TOKEN_DELTA",
    "AGENT_TOOL_CALL",
    "AGENT_TYPING",
    "MESSAGE_CREATED",
    "MESSAGE_UPDATED",
    "THREAD_UPDATED",
    "SenderInfo",
    "SenderResolver",
    "build_agent_confirmation_requested_payload",
    "build_agent_confirmation_resolved_payload",
    "build_agent_thinking_delta_payload",
    "build_agent_token_delta_payload",
    "build_agent_tool_call_payload",
    "build_agent_typing_payload",
    "build_message_payload",
    "build_thread_updated_payload",
    "bump_channel_message_stats",
    "counts_as_thread_reply",
    "drop_thread_reply",
    "publish_channel_event_to_members",
    "record_thread_reply",
    "track_agent_message_resources",
]
