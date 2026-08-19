"""Org-wide mention-state pubsub on channel ``mentions:{org_id}``. Runs
under the ops deadline guard.
"""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.json_codec import dumps_bytes
from uniffy.core.valkey.ops import ops_call

LOGGER_COMPONENT = "mentions"
_NAMESPACE = "mentions"


async def publish_mention_state(
    organization_id: UUID,
    urn: str,
    changes: dict[str, Any],
) -> None:
    """Publish a mention state change so live chips refresh in place."""
    from uniffy.core.valkey import pubsub

    redis = pubsub._pubsub_client
    if redis is None:
        return

    channel = f"mentions:{organization_id}"
    payload: dict[str, Any] = {
        "_type": pubsub.NotificationPayloadType.MENTION_STATE_CHANGED,
        "urn": urn,
        "changes": {k: str(v) for k, v in changes.items()},
    }
    try:
        async with ops_call(_NAMESPACE, "mentions_publish"):
            message = dumps_bytes(payload)
            await redis.publish(channel, message)
        logger.debug(f"published mention state change for {urn}", component=LOGGER_COMPONENT)
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Failed to publish mention state to {channel}", component=LOGGER_COMPONENT)
