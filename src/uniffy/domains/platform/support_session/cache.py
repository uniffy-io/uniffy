"""Valkey hot cache for ``active_session_for(user_id, org_id)``; TTL tracks
remaining session time.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_set,
)

_NAMESPACE = "support_session"
_MAX_TTL_SECONDS = 30 * 60


def _key(user_id: UUID, org_id: UUID) -> str:
    return f"{_NAMESPACE}:{user_id}:{org_id}"


def _user_tag(user_id: UUID) -> str:
    return f"user:{user_id}"


def _ttl_until(expires_at: datetime) -> int:
    now = datetime.now(UTC)
    if expires_at <= now:
        return 0
    delta = (expires_at - now).total_seconds()
    return max(1, min(_MAX_TTL_SECONDS, int(delta)))


async def get_active_session(user_id: UUID, org_id: UUID) -> dict[str, Any] | None | object:
    """Return cached payload, ``None`` for explicit-none, or CACHE_MISS."""
    return await cache_get(_key(user_id, org_id))


async def set_active_session(
    user_id: UUID,
    org_id: UUID,
    payload: dict[str, Any],
    expires_at: datetime,
) -> None:
    ttl = _ttl_until(expires_at)
    if ttl == 0:
        return
    await cache_set(
        _key(user_id, org_id),
        payload,
        ttl=ttl,
        tags=[_user_tag(user_id)],
    )


async def invalidate_active_session(user_id: UUID, org_id: UUID) -> None:
    await cache_delete(_key(user_id, org_id))


__all__ = [
    "CACHE_MISS",
    "get_active_session",
    "set_active_session",
    "invalidate_active_session",
]
