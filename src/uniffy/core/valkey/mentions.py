"""Valkey Pub/Sub for real-time mention state change broadcasting.

Publishes mention state change events to org-wide channels when content
that can be referenced via URN mentions is modified. Subscribers (the
notification stream handler) relay these events to connected clients so
MentionChip components can update in real-time.

Channel pattern: mentions:{org_id}
"""

import json
from typing import Any
from uuid import UUID

from loguru import logger

LOGGER_COMPONENT = "mentions"


def _get_client():
    """Return the Pub/Sub publisher connection (lazy import to avoid cycles)."""
    from uniffy.core.valkey.pubsub import _publisher

    return _publisher


async def publish_mention_state(
    organization_id: UUID,
    urn: str,
    changes: dict[str, Any],
) -> None:
    """Publish a mention state change to the org-wide mentions channel.

    Called by domain operations when content state changes (task status,
    calendar event time, file processing completion, etc.).

    Parameters
    ----------
    organization_id : UUID
        Organization scope for the channel.
    urn : str
        URN of the content whose state changed.
    changes : dict[str, Any]
        Changed fields as key-value pairs. Values are converted to strings.

    """
    redis = _get_client()
    if redis is None:
        logger.warning(
            "publisher not initialized, skipping mention publish",
            component=LOGGER_COMPONENT,
        )
        return

    channel = f"mentions:{organization_id}"
    payload: dict[str, Any] = {
        "_type": "mention_state_changed",
        "urn": urn,
        "changes": {k: str(v) for k, v in changes.items()},
    }

    try:
        message = json.dumps(payload)
        await redis.publish(channel, message)
        logger.debug(f"published mention state change for {urn}", component=LOGGER_COMPONENT)
    except Exception:
        logger.warning(f"Failed to publish mention state to {channel}", component=LOGGER_COMPONENT)
