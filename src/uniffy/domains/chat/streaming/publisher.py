"""Fan out chat events to per-user Valkey channels (chat:user:{user_id})."""

from typing import Any
from uuid import UUID

from uniffy.core.json_codec import dumps_bytes
from uniffy.infrastructure.valkey.pubsub import publish_bytes, publish_many


async def _publish_to_channel(channel_name: str, payload: bytes) -> None:
    await publish_bytes(channel_name, payload)


async def publish_channel_event_to_members(
    member_ids: list[UUID],
    event_type: str,
    payload: dict[str, Any],
    channel_id: UUID | None = None,
    exclude_user_id: UUID | None = None,
) -> None:
    """Pipelined fan-out to each member's chat:user:{user_id} so it costs one RTT, not N."""
    data: dict[str, Any] = {"_type": event_type, **payload}
    if channel_id and "channel_id" not in data:  # noqa: PLR2004
        data["channel_id"] = str(channel_id)
    message = dumps_bytes(data, default=str)

    targets = [uid for uid in member_ids if uid != exclude_user_id]
    if not targets:
        return

    await publish_many([(f"chat:user:{uid}", message) for uid in targets])


async def publish_user_chat_event(
    user_id: UUID,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """User-level chat event to a single user (unread counts, mentions)."""
    data = {
        "_type": event_type,
        **payload,
    }
    message = dumps_bytes(data, default=str)
    await _publish_to_channel(f"chat:user:{user_id}", message)


async def publish_user_chat_events(
    events: list[tuple[UUID, str, dict[str, Any]]],
) -> None:
    """Pipelined per-user fan-out for payloads that differ per recipient
    (e.g. unread counts with per-user mention counts); one RTT, not N.
    """
    if not events:
        return

    await publish_many([
        (
            f"chat:user:{user_id}",
            dumps_bytes({"_type": event_type, **payload}, default=str),
        )
        for user_id, event_type, payload in events
    ])
