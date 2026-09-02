"""Org-wide mention-state pubsub on channel ``mentions:{org_id}``. Runs
under the ops deadline guard.
"""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.events.realtime import NotificationPayloadType
from uniffy.infrastructure.valkey.ops import ops_call
from uniffy.infrastructure.valkey.pubsub import publish_to_channel

logger = logger.bind(component="core.content.mentions")
_NAMESPACE = "mentions"


async def publish_mention_state(
    organization_id: UUID,
    urn: str,
    changes: dict[str, Any],
) -> None:
    """Publish a mention state change so live chips refresh in place."""
    channel = f"mentions:{organization_id}"
    payload: dict[str, Any] = {
        "_type": NotificationPayloadType.MENTION_STATE_CHANGED,
        "urn": urn,
        "changes": {k: str(v) for k, v in changes.items()},
    }
    try:
        async with ops_call(_NAMESPACE, "mentions_publish"):
            await publish_to_channel(channel, payload)
        logger.debug(f"published mention state change for {urn}")
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Failed to publish mention state to {channel}")
