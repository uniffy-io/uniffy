"""Notification settings cache helpers.

Thin wrappers around the generic Valkey cache layer, namespaced under
``settings:notifications:{user_id}``.
"""

from typing import Any
from uuid import UUID

from uniffy.core.valkey.cache import _CacheMiss, cache_delete, cache_get, cache_set

_PREFIX = "settings:notifications"


def _key(user_id: UUID) -> str:
    return f"{_PREFIX}:{user_id}"


async def get_cached_settings(
    user_id: UUID,
) -> dict[str, Any] | None | _CacheMiss:
    """Fetch cached notification settings for a user."""
    return await cache_get(_key(user_id))


async def set_cached_settings(
    user_id: UUID,
    settings: dict[str, Any] | None,
) -> None:
    """Store notification settings in cache (15-min TTL)."""
    await cache_set(_key(user_id), settings)


async def invalidate_cached_settings(user_id: UUID) -> None:
    """Delete cached notification settings for a user."""
    await cache_delete(_key(user_id))
