"""Chat event publishing to Valkey Pub/Sub.

All chat events are fanned out to per-user Valkey channels:
  chat:user:{user_id}

This eliminates per-channel Valkey subscriptions. Each user maintains
a single persistent subscription to their own channel. The frontend
filters events by channel_id to decide what to display.
"""

import json
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.pubsub import _publisher

LOGGER_COMPONENT = "chat.publisher"


async def _publish_to_channel(channel_name: str, payload: str) -> None:
    """Publish a pre-serialized JSON string to a Valkey channel."""
    if _publisher is None:
        return

    try:
        await _publisher.publish(channel_name, payload)
    except Exception:
        logger.warning(
            f"Failed to publish to {channel_name}",
            component=LOGGER_COMPONENT,
        )


async def publish_channel_event_to_members(
    member_ids: list[UUID],
    event_type: str,
    payload: dict[str, Any],
    channel_id: UUID | None = None,
    exclude_user_id: UUID | None = None,
) -> None:
    """Fan out a channel event to all members' user channels.

    Serializes the payload once, then publishes to each member's
    `chat:user:{user_id}` channel. Skips `exclude_user_id` if set
    (e.g. skip the sender for typing events).

    Parameters
    ----------
    member_ids : list[UUID]
        Channel member user IDs to publish to.
    event_type : str
        Event type constant from streaming.events.
    payload : dict
        Event payload (message data, reaction data, etc.).
    channel_id : UUID | None
        Channel ID to include in the payload. If not already in payload,
        it will be added.
    exclude_user_id : UUID | None
        User ID to exclude from fan-out (e.g. the sender).

    """
    if _publisher is None:
        return

    data: dict[str, Any] = {"_type": event_type, **payload}
    if channel_id and "channel_id" not in data:
        data["channel_id"] = str(channel_id)
    message = json.dumps(data, default=str)

    for uid in member_ids:
        if exclude_user_id and uid == exclude_user_id:
            continue
        await _publish_to_channel(f"chat:user:{uid}", message)


async def publish_user_chat_event(
    user_id: UUID,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Publish a user-level chat event to a single user.

    Used for events that target a specific user (unread counts, mentions).
    """
    if _publisher is None:
        return

    data = {
        "_type": event_type,
        **payload,
    }
    message = json.dumps(data, default=str)
    await _publish_to_channel(f"chat:user:{user_id}", message)
