from uuid import UUID

from uniffy.core.cache.operations import CACHE_MISS, cache_delete, cache_get, cache_set

_TEAM_IDS_TTL_SECONDS = 300


def _user_teams_key(organization_id: UUID, user_id: UUID) -> str:
    return f"people:user_teams:{organization_id}:{user_id}"


async def get_cached_user_team_ids(organization_id: UUID, user_id: UUID) -> list[str] | None:
    cached = await cache_get(_user_teams_key(organization_id, user_id))
    if cached is CACHE_MISS or cached is None:
        return None
    return cached.get("team_ids", [])


async def set_cached_user_team_ids(
    organization_id: UUID,
    user_id: UUID,
    team_ids: list[str],
) -> None:
    await cache_set(
        _user_teams_key(organization_id, user_id),
        {"team_ids": team_ids},
        _TEAM_IDS_TTL_SECONDS,
        tags=[f"people:{organization_id}", f"user:{user_id}"],
    )


async def invalidate_user_teams(organization_id: UUID, user_id: UUID) -> None:
    await cache_delete(_user_teams_key(organization_id, user_id))
