"""Valkey operations for ephemeral user presence.

Stores per-user presence state (online/away/DND/offline) in Valkey with
a 120-second TTL. Each heartbeat resets the TTL; if the client disconnects,
the key expires naturally and the user goes offline.

Key pattern: presence:{org_id}:{user_id}
Channel pattern: presence:{org_id}  (for broadcasting state changes)

Reuses the global publisher connection from pubsub.py (same pattern as cache.py).
"""

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

_PRESENCE_TTL = 120  # seconds
_MAX_BULK_IDS = 200

LOGGER_COMPONENT = "presence"


def _get_client():
    """Return the Pub/Sub publisher connection (lazy import to avoid cycles)."""
    from uniffy.core.valkey.pubsub import _publisher

    return _publisher


def _presence_key(org_id: UUID, user_id: UUID) -> str:
    """Build the Valkey key for a user's presence in an org."""
    return f"presence:{org_id}:{user_id}"


def _presence_channel(org_id: UUID) -> str:
    """Build the Pub/Sub channel name for org-wide presence changes."""
    return f"presence:{org_id}"


async def presence_set(
    org_id: UUID,
    user_id: UUID,
    status: str,
    client: str,
) -> str | None:
    """Set a user's presence state in Valkey.

    Parameters
    ----------
    org_id : UUID
        Organization scope.
    user_id : UUID
        The user whose presence is being set.
    status : str
        Presence status ("online", "away", "dnd", "offline").
    client : str
        Client type ("web", "mobile", "desktop").

    Returns
    -------
    str | None
        The previous status if it changed, None if unchanged or on error.

    """
    redis = _get_client()
    if redis is None:
        logger.warning("publisher not initialized, skipping presence", component=LOGGER_COMPONENT)
        return None

    key = _presence_key(org_id, user_id)
    now = datetime.now(UTC).isoformat()
    new_value = json.dumps({"status": status, "last_active": now, "client": client})

    try:
        # Read existing value to detect changes
        existing_raw = await redis.get(key)
        previous_status: str | None = None
        if existing_raw is not None:
            try:
                existing = json.loads(existing_raw)
                previous_status = existing.get("status")
            except json.JSONDecodeError, TypeError:
                pass

        # Set with TTL regardless of whether status changed (resets heartbeat)
        await redis.set(key, new_value, ex=_PRESENCE_TTL)

        if previous_status is not None and previous_status != status:
            return previous_status
        if previous_status is None:
            # First heartbeat - treat as a change (user just came online)
            return "__new__"
        return None

    except Exception:
        logger.warning(f"presence_set failed for {key}", component=LOGGER_COMPONENT)
        return None


async def presence_get_bulk(
    org_id: UUID,
    user_ids: list[UUID],
) -> dict[str, dict[str, Any]]:
    """Get presence state for multiple users via MGET.

    Parameters
    ----------
    org_id : UUID
        Organization scope.
    user_ids : list[UUID]
        User IDs to query (max 200).

    Returns
    -------
    dict[str, dict]
        Mapping of user_id (str) to presence data. Users not found in Valkey
        are omitted (caller should treat them as offline).

    Raises
    ------
    ValueError
        If more than 200 user IDs are requested.

    """
    if len(user_ids) > _MAX_BULK_IDS:
        raise ValueError(f"Maximum {_MAX_BULK_IDS} user IDs per request")

    if not user_ids:
        return {}

    redis = _get_client()
    if redis is None:
        logger.warning("publisher not initialized, skipping bulk get", component=LOGGER_COMPONENT)
        return {}

    keys = [_presence_key(org_id, uid) for uid in user_ids]

    try:
        values = await redis.mget(keys)
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
        except json.JSONDecodeError, TypeError:
            logger.warning(f"Invalid presence data for user {uid}", component=LOGGER_COMPONENT)

    return result


async def presence_publish_change(
    org_id: UUID,
    user_id: UUID,
    status: str,
    last_active: str,
    custom_status: dict[str, Any] | None = None,
) -> None:
    """Publish a presence change event to the org-wide channel.

    Parameters
    ----------
    org_id : UUID
        Organization scope.
    user_id : UUID
        User whose presence changed.
    status : str
        New presence status.
    last_active : str
        ISO 8601 timestamp of last activity.
    custom_status : dict | None
        Custom status data (emoji, text, expires_at) or None.

    """
    redis = _get_client()
    if redis is None:
        logger.warning("publisher not initialized, skipping publish", component=LOGGER_COMPONENT)
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
        message = json.dumps(payload)
        await redis.publish(channel, message)
        logger.debug(f"published presence change for {user_id}", component=LOGGER_COMPONENT)
    except Exception:
        logger.warning(f"Failed to publish presence change to {channel}", component=LOGGER_COMPONENT)
