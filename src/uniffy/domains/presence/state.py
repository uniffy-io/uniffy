"""Per-user presence state and realtime publication with expiry-based offline status."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.events.realtime import NotificationPayloadType
from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call
from uniffy.infrastructure.valkey.pubsub import publish_to_channel

logger = logger.bind(component="presence.state")

_PRESENCE_TTL = 120
_MAX_BULK_IDS = 200
_NAMESPACE = "presence"

# Stored status vocabulary; the proto mapping lives in domains/presence/converters.py.
PRESENCE_STATUS_ONLINE = "online"
PRESENCE_STATUS_DND = "dnd"


def _presence_key(org_id: UUID, user_id: UUID) -> str:
    return f"presence:{org_id}:{user_id}"


def _presence_channel(org_id: UUID) -> str:
    return f"presence:{org_id}"


async def presence_set(
    org_id: UUID,
    user_id: UUID,
    status: str,
    client: str,
) -> str | None:
    """Set presence; returns previous status if it changed, ``"__new__"``
    on first heartbeat, ``None`` otherwise.
    """
    redis = get_ops_client()
    if redis is None:
        return None

    key = _presence_key(org_id, user_id)
    now = datetime.now(UTC).isoformat()
    new_value = dumps_bytes({"status": status, "last_active": now, "client": client})

    try:
        async with ops_call(_NAMESPACE, "presence_get"):
            existing_raw = await redis.get(key)
        previous_status: str | None = None
        if existing_raw is not None:
            try:
                existing = loads(existing_raw)
                previous_status = existing.get("status")
            except JSONDecodeError, TypeError:
                pass

        async with ops_call(_NAMESPACE, "presence_set"):
            await redis.set(key, new_value, ex=_PRESENCE_TTL)

        if previous_status is not None and previous_status != status:
            return previous_status
        if previous_status is None:
            return "__new__"
        return None

    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"presence_set failed for {key}")
        return None


async def presence_get_bulk(
    org_id: UUID,
    user_ids: list[UUID],
) -> dict[str, dict[str, Any]]:
    """MGET presence for many users; absent users are omitted (treat as offline). Cap 200 ids."""
    if len(user_ids) > _MAX_BULK_IDS:
        raise ValueError(f"Maximum {_MAX_BULK_IDS} user IDs per request")

    if not user_ids:
        return {}

    redis = get_ops_client()
    if redis is None:
        return {}

    keys = [_presence_key(org_id, uid) for uid in user_ids]

    try:
        async with ops_call(_NAMESPACE, "presence_get_bulk"):
            values = await redis.mget(keys)
    except TimeoutError:
        return {}
    except Exception:
        logger.warning("presence_get_bulk MGET failed")
        return {}

    result: dict[str, dict[str, Any]] = {}
    for uid, raw in zip(user_ids, values, strict=True):
        if raw is None:
            continue
        try:
            data = loads(raw)
            result[str(uid)] = data
        except JSONDecodeError, TypeError:
            logger.warning(f"Invalid presence data for user {uid}")

    return result


async def presence_publish_change(
    org_id: UUID,
    user_id: UUID,
    status: str,
    last_active: str,
    custom_status: dict[str, Any] | None = None,
) -> None:
    """Publish a presence change on ``presence:{org_id}`` under the ops deadline guard."""
    channel = _presence_channel(org_id)
    payload: dict[str, Any] = {
        "_type": NotificationPayloadType.PRESENCE_CHANGED,
        "user_id": str(user_id),
        "status": status,
        "last_active": last_active,
    }
    if custom_status:
        payload["custom_status"] = custom_status

    try:
        async with ops_call(_NAMESPACE, "presence_publish"):
            await publish_to_channel(channel, payload)
        logger.debug(f"published presence change for {user_id}")
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Failed to publish presence change to {channel}")
