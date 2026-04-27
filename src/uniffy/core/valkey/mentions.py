"""Valkey Pub/Sub for real-time mention state change broadcasting.

Publishes mention state change events to org-wide channels when content
that can be referenced via URN mentions is modified. Subscribers (the
notification stream handler) relay these events to connected clients so
MentionChip components can update in real-time.

Channel pattern: mentions:{org_id}

PUBLISH is a pubsub command so this module reuses the pubsub client.
The publish call runs under the same fail-fast deadline guard as the
ops calls so a slow Valkey can't block a content mutation.
"""

import json
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import ops_call

LOGGER_COMPONENT = "mentions"
_NAMESPACE = "mentions"


async def publish_mention_state(
    organization_id: UUID,
    urn: str,
    changes: dict[str, Any],
) -> None:
    """Publish a mention state change to the org-wide mentions channel.

    Called by domain operations when content state changes (task status,
    calendar event time, file processing completion, etc.).
    """
    from uniffy.core.valkey import pubsub

    redis = pubsub._pubsub_client
    if redis is None:
        return

    channel = f"mentions:{organization_id}"
    payload: dict[str, Any] = {
        "_type": "mention_state_changed",
        "urn": urn,
        "changes": {k: str(v) for k, v in changes.items()},
    }

    try:
        async with ops_call(_NAMESPACE, "mentions_publish"):
            message = json.dumps(payload)
            await redis.publish(channel, message)
        logger.debug(f"published mention state change for {urn}", component=LOGGER_COMPONENT)
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Failed to publish mention state to {channel}", component=LOGGER_COMPONENT)
