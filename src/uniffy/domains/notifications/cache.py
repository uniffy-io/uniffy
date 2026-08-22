"""Notification settings cache helpers."""

import asyncio
from typing import Any
from uuid import UUID

from uniffy.core.valkey.cache import (
    _CacheMiss,
    cache_delete,
    cache_get,
    cache_get_many,
    cache_set,
)

_PREFIX = "settings:notifications"
_SET_CONCURRENCY = 50


def _key(user_id: UUID) -> str:
    return f"{_PREFIX}:{user_id}"


async def get_cached_settings(
    user_id: UUID,
) -> dict[str, Any] | None | _CacheMiss:
    return await cache_get(_key(user_id))


async def set_cached_settings(
    user_id: UUID,
    settings: dict[str, Any] | None,
) -> None:
    await cache_set(_key(user_id), settings)


async def get_cached_settings_bulk(
    user_ids: list[UUID],
) -> tuple[dict[UUID, dict[str, Any] | None], list[UUID]]:
    key_to_user = {_key(user_id): user_id for user_id in user_ids}
    hits, misses = await cache_get_many(list(key_to_user))
    return (
        {key_to_user[key]: value for key, value in hits.items()},
        [key_to_user[key] for key in misses],
    )


async def set_cached_settings_bulk(
    settings_by_user: dict[UUID, dict[str, Any] | None],
) -> None:
    items = list(settings_by_user.items())
    for offset in range(0, len(items), _SET_CONCURRENCY):
        chunk = items[offset : offset + _SET_CONCURRENCY]
        await asyncio.gather(*(set_cached_settings(user_id, value) for user_id, value in chunk))


async def invalidate_cached_settings(user_id: UUID) -> None:
    await cache_delete(_key(user_id))
