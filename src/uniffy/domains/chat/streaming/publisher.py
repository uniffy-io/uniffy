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

from uniffy.core.valkey import pubsub

LOGGER_COMPONENT = "chat.publisher"


async def _publish_to_channel(channel_name: str, payload: str) -> None:
    """Publish a pre-serialized JSON string to a Valkey channel."""
    # Read through the module every time so `init_pubsub` rebinding
    # `pubsub._pubsub_client` after this module has been imported is
    # picked up. A captured-at-import-time reference would freeze the
    # pre-init ``None`` value and silently drop every publish when the
    # worker (which imports chat_integration eagerly) loaded publisher
    # before init_pubsub ran.
    publisher = pubsub._pubsub_client
    if publisher is None:
        return

    try:
        await publisher.publish(channel_name, payload)
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

    Serializes the payload once, then PUBLISHes to each member's
    `chat:user:{user_id}` channel inside a single redis pipeline so the
    whole fan-out costs one round-trip instead of N. Skips
    ``exclude_user_id`` if set (e.g. skip the sender for typing events).

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
    publisher = pubsub._pubsub_client
    if publisher is None:
        return

    data: dict[str, Any] = {"_type": event_type, **payload}
    if channel_id and "channel_id" not in data:
        data["channel_id"] = str(channel_id)
    message = json.dumps(data, default=str)

    targets = [uid for uid in member_ids if uid != exclude_user_id]
    if not targets:
        return

    try:
        async with publisher.pipeline(transaction=False) as pipe:
            for uid in targets:
                pipe.publish(f"chat:user:{uid}", message)
            await pipe.execute()
    except Exception:
        logger.warning(
            f"Pipelined fan-out failed for {event_type} to {len(targets)} members",
            component=LOGGER_COMPONENT,
        )


async def publish_user_chat_event(
    user_id: UUID,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Publish a user-level chat event to a single user.

    Used for events that target a specific user (unread counts, mentions).
    """
    if pubsub._pubsub_client is None:
        return

    data = {
        "_type": event_type,
        **payload,
    }
    message = json.dumps(data, default=str)
    await _publish_to_channel(f"chat:user:{user_id}", message)
