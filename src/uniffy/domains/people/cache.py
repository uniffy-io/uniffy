"""Valkey helpers for person payloads and the org chart."""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from uniffy.core.cache.operations import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
    cache_set,
)

PROFILE_TTL_SECONDS = 300
CHART_TTL_SECONDS = 300


def _profile_key(organization_id: UUID, user_id: UUID) -> str:
    return f"people:profile:{organization_id}:{user_id}"


def _chart_key(organization_id: UUID) -> str:
    return f"people:chart:{organization_id}"


def _user_teams_key(organization_id: UUID, user_id: UUID) -> str:
    return f"people:user_teams:{organization_id}:{user_id}"


def _org_tag(organization_id: UUID) -> str:
    return f"people:{organization_id}"


async def get_cached_person(organization_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    cached = await cache_get(_profile_key(organization_id, user_id))
    if cached is CACHE_MISS or cached is None:
        return None
    return cached


async def set_cached_person(organization_id: UUID, user_id: UUID, payload: dict[str, Any]) -> None:
    await cache_set(
        _profile_key(organization_id, user_id),
        payload,
        PROFILE_TTL_SECONDS,
        tags=[_org_tag(organization_id), f"user:{user_id}"],
    )


async def get_cached_user_team_ids(organization_id: UUID, user_id: UUID) -> list[str] | None:
    cached = await cache_get(_user_teams_key(organization_id, user_id))
    if cached is CACHE_MISS or cached is None:
        return None
    return cached.get("team_ids", [])


async def set_cached_user_team_ids(
    organization_id: UUID, user_id: UUID, team_ids: list[str]
) -> None:
    await cache_set(
        _user_teams_key(organization_id, user_id),
        {"team_ids": team_ids},
        PROFILE_TTL_SECONDS,
        tags=[_org_tag(organization_id), f"user:{user_id}"],
    )


async def invalidate_person(organization_id: UUID, user_id: UUID) -> None:
    await cache_delete(_profile_key(organization_id, user_id))
    await cache_delete(_user_teams_key(organization_id, user_id))


async def invalidate_chart(organization_id: UUID) -> None:
    await cache_delete(_chart_key(organization_id))


async def invalidate_org_people(organization_id: UUID) -> None:
    await cache_invalidate_by_tag(_org_tag(organization_id))


async def cached_org_chart(
    organization_id: UUID,
    loader: Callable[[], Awaitable[dict[str, Any] | None]],
) -> dict[str, Any] | None:
    """Stampede-protected; a 500-person chart is a Monday-morning hot key."""
    return await cache_get_or_set_locked(
        _chart_key(organization_id),
        loader,
        CHART_TTL_SECONDS,
        tags=[_org_tag(organization_id)],
    )
