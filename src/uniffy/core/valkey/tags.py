"""Org-wide tag-event pubsub on channel ``tags:{org_id}``.

Event types: ``tag.created`` / ``tag.updated`` (payload ``{"tag": {...}}``),
``tag.deleted`` (``{"tag_id": str}``), ``tag.assignment.changed``
(``{"content_urn", "content_type", "added", "removed"}``).
"""

import json
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import ops_call

LOGGER_COMPONENT = "tags"
_NAMESPACE = "tags"

EVENT_TAG_CREATED = "tag.created"
EVENT_TAG_UPDATED = "tag.updated"
EVENT_TAG_DELETED = "tag.deleted"
EVENT_TAG_ASSIGNMENT_CHANGED = "tag.assignment.changed"

_VALID_EVENT_TYPES = frozenset({
    EVENT_TAG_CREATED,
    EVENT_TAG_UPDATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_ASSIGNMENT_CHANGED,
})


async def publish_tag_event(
    organization_id: UUID,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Publish a tag event. Fire-and-forget; unknown ``event_type`` is rejected with a debug log."""
    if event_type not in _VALID_EVENT_TYPES:
        logger.debug(
            f"publish_tag_event: rejecting unknown event type {event_type!r}",
            component=LOGGER_COMPONENT,
        )
        return

    from uniffy.core.valkey import pubsub

    redis = pubsub._pubsub_client
    if redis is None:
        return

    channel = f"tags:{organization_id}"
    message: dict[str, Any] = {
        "_type": event_type,
        "payload": payload,
    }

    try:
        async with ops_call(_NAMESPACE, "tags_publish"):
            await redis.publish(channel, json.dumps(message, default=str))
        logger.debug(
            f"published {event_type} on {channel}",
            component=LOGGER_COMPONENT,
        )
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"Failed to publish tag event to {channel}",
            component=LOGGER_COMPONENT,
        )
