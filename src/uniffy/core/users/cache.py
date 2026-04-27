"""User + agent profile cache helpers.

Caches the small, public profile fields that ``SenderResolver`` and
similar lookup paths read on every request:

- ``user:{user_id}:profile``  -> {display_name, avatar_key, username}, TTL 1800s
- ``agent:{agent_id}:profile`` -> {name, avatar_key, avatar_emoji}, TTL 1800s

The values are non-secret display metadata only. Profile rows mutate
infrequently (avatar upload, name edit), so a 30-minute TTL is a
generous cushion. Each mutation site invalidates the single key.
"""

from typing import Any
from uuid import UUID

from uniffy.core.valkey.cache import (
    cache_delete,
    cache_get_many,
    cache_set,
)

_USER_TTL_SECONDS = 1800
_AGENT_TTL_SECONDS = 1800


def _user_profile_key(user_id: UUID) -> str:
    return f"user:{user_id}:profile"


def _agent_profile_key(agent_id: UUID) -> str:
    return f"agent:{agent_id}:profile"


async def get_cached_user_profiles(
    user_ids: list[UUID],
) -> tuple[dict[UUID, dict[str, Any]], list[UUID]]:
    """Bulk-fetch cached user profiles.

    Returns ``(hit_map, miss_user_ids)``. ``hit_map`` is
    ``user_id -> {"display_name", "avatar_key", "username"}``. The miss
    list preserves input order so the caller can re-issue a PG query.
    """
    if not user_ids:
        return {}, []

    keys = [_user_profile_key(uid) for uid in user_ids]
    hits, misses = await cache_get_many(keys)

    hit_map: dict[UUID, dict[str, Any]] = {}
    miss_uids: list[UUID] = []
    miss_set = set(misses)

    for key, uid in zip(keys, user_ids, strict=True):
        if key in miss_set:
            miss_uids.append(uid)
            continue
        payload = hits.get(key)
        if payload is None:
            miss_uids.append(uid)
            continue
        hit_map[uid] = payload

    return hit_map, miss_uids


async def set_cached_user_profile(
    user_id: UUID,
    *,
    display_name: str,
    avatar_key: str | None,
    username: str,
) -> None:
    await cache_set(
        _user_profile_key(user_id),
        {
            "display_name": display_name,
            "avatar_key": avatar_key,
            "username": username,
        },
        ttl=_USER_TTL_SECONDS,
    )


async def invalidate_user_profile(user_id: UUID) -> None:
    await cache_delete(_user_profile_key(user_id))


async def get_cached_agent_profiles(
    agent_ids: list[UUID],
) -> tuple[dict[UUID, dict[str, Any]], list[UUID]]:
    """Bulk-fetch cached agent profiles."""
    if not agent_ids:
        return {}, []

    keys = [_agent_profile_key(aid) for aid in agent_ids]
    hits, misses = await cache_get_many(keys)

    hit_map: dict[UUID, dict[str, Any]] = {}
    miss_aids: list[UUID] = []
    miss_set = set(misses)

    for key, aid in zip(keys, agent_ids, strict=True):
        if key in miss_set:
            miss_aids.append(aid)
            continue
        payload = hits.get(key)
        if payload is None:
            miss_aids.append(aid)
            continue
        hit_map[aid] = payload

    return hit_map, miss_aids


async def set_cached_agent_profile(
    agent_id: UUID,
    *,
    name: str,
    avatar_key: str | None,
    avatar_emoji: str | None,
) -> None:
    await cache_set(
        _agent_profile_key(agent_id),
        {
            "name": name,
            "avatar_key": avatar_key,
            "avatar_emoji": avatar_emoji,
        },
        ttl=_AGENT_TTL_SECONDS,
    )


async def invalidate_agent_profile(agent_id: UUID) -> None:
    await cache_delete(_agent_profile_key(agent_id))
