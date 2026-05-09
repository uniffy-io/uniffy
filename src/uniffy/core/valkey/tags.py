"""Valkey Pub/Sub for real-time tag state change broadcasting.

Mirrors the existing ``mentions.py`` pattern: tag CRUD and assignment
mutations publish to the org-wide ``tags:{org_id}`` channel so any
connected client (the explorer dashboard, an open content view with
visible tag chips, the notification stream) can refresh its in-memory
state without polling.

Channel pattern: ``tags:{org_id}``

Event types
-----------
- ``tag.created``        — payload: ``{"tag": {...}}``
- ``tag.updated``        — payload: ``{"tag": {...}}``
- ``tag.deleted``        — payload: ``{"tag_id": str}``
- ``tag.assignment.changed`` — payload:
  ``{"content_urn": str, "content_type": str, "added": [tag_id, ...],
  "removed": [tag_id, ...]}``

The publish call runs under the same fail-fast deadline guard as the
ops calls so a slow Valkey can't block a tag mutation.
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
    """Publish a tag event to the org-wide tags channel.

    A bad event type is rejected with a debug log; the call is otherwise
    fire-and-forget. A missing pubsub client or a Valkey timeout makes
    the call a no-op so domain operations cannot stall on real-time
    fan-out.
    """
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
