"""Valkey hot cache for ``active_session_for(user_id, org_id)``.

The :class:`PermissionChecker` calls this lookup on every read of
tenant content while a support session is active. A Valkey cache
makes the hot path single-digit-ms; the value lives only as long
as the session itself (TTL = remaining time on the session).

State changes (approve / revoke / expire) invalidate the key so
the next request sees the new state within one Valkey round-trip.
A `tag:user:{user_id}` membership lets a future token_version bump
drop every cached session for a user at once.
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
    """Seconds until ``expires_at``, clamped to ``_MAX_TTL_SECONDS``."""
    now = datetime.now(UTC)
    if expires_at <= now:
        return 0
    delta = (expires_at - now).total_seconds()
    return max(1, min(_MAX_TTL_SECONDS, int(delta)))


async def get_active_session(
    user_id: UUID, org_id: UUID
) -> dict[str, Any] | None | object:
    """Return cached session payload, ``None`` for explicit-none, or CACHE_MISS."""
    return await cache_get(_key(user_id, org_id))


async def set_active_session(
    user_id: UUID,
    org_id: UUID,
    payload: dict[str, Any],
    expires_at: datetime,
) -> None:
    """Cache an active session with TTL = remaining time on the session."""
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
    """Drop the cached row for one (user, org) pair."""
    await cache_delete(_key(user_id, org_id))


__all__ = [
    "CACHE_MISS",
    "get_active_session",
    "set_active_session",
    "invalidate_active_session",
]
