"""Fan out chat events to per-user Valkey channels (chat:user:{user_id})."""

import json
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey import pubsub

LOGGER_COMPONENT = "chat.publisher"


async def _publish_to_channel(channel_name: str, payload: str) -> None:
    # Read through the module so a post-import init_pubsub rebind is picked up.
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
    """Pipelined fan-out to each member's chat:user:{user_id} so it costs one RTT, not N."""
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
    """User-level chat event to a single user (unread counts, mentions)."""
    if pubsub._pubsub_client is None:
        return

    data = {
        "_type": event_type,
        **payload,
    }
    message = json.dumps(data, default=str)
    await _publish_to_channel(f"chat:user:{user_id}", message)
