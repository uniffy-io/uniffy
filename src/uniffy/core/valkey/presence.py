"""Per-user presence state with 120s TTL. Each heartbeat resets the TTL; expiry means offline.

Keys ``presence:{org_id}:{user_id}``; channel ``presence:{org_id}``.
"""

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client, ops_call

_PRESENCE_TTL = 120
_MAX_BULK_IDS = 200
_NAMESPACE = "presence"

LOGGER_COMPONENT = "presence"


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
    redis = _get_ops_client()
    if redis is None:
        return None

    key = _presence_key(org_id, user_id)
    now = datetime.now(UTC).isoformat()
    new_value = json.dumps({"status": status, "last_active": now, "client": client})

    try:
        async with ops_call(_NAMESPACE, "presence_get"):
            existing_raw = await redis.get(key)
        previous_status: str | None = None
        if existing_raw is not None:
            try:
                existing = json.loads(existing_raw)
                previous_status = existing.get("status")
            except (json.JSONDecodeError, TypeError):
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
        logger.warning(f"presence_set failed for {key}", component=LOGGER_COMPONENT)
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

    redis = _get_ops_client()
    if redis is None:
        return {}

    keys = [_presence_key(org_id, uid) for uid in user_ids]

    try:
        async with ops_call(_NAMESPACE, "presence_get_bulk"):
            values = await redis.mget(keys)
    except TimeoutError:
        return {}
    except Exception:
        logger.warning("presence_get_bulk MGET failed", component=LOGGER_COMPONENT)
        return {}

    result: dict[str, dict[str, Any]] = {}
    for uid, raw in zip(user_ids, values, strict=True):
        if raw is None:
            continue
        try:
            data = json.loads(raw)
            result[str(uid)] = data
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"Invalid presence data for user {uid}", component=LOGGER_COMPONENT)

    return result


async def presence_publish_change(
    org_id: UUID,
    user_id: UUID,
    status: str,
    last_active: str,
    custom_status: dict[str, Any] | None = None,
) -> None:
    """Publish a presence change on ``presence:{org_id}`` under the ops deadline guard."""
    from uniffy.core.valkey import pubsub

    redis = pubsub._pubsub_client
    if redis is None:
        return

    channel = _presence_channel(org_id)
    payload: dict[str, Any] = {
        "_type": "presence_changed",
        "user_id": str(user_id),
        "status": status,
        "last_active": last_active,
    }
    if custom_status:
        payload["custom_status"] = custom_status

    try:
        async with ops_call(_NAMESPACE, "presence_publish"):
            message = json.dumps(payload)
            await redis.publish(channel, message)
        logger.debug(f"published presence change for {user_id}", component=LOGGER_COMPONENT)
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Failed to publish presence change to {channel}", component=LOGGER_COMPONENT)
