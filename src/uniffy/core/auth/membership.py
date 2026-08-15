"""Cached "is the user still an active org member" check.

Hot path: realtime WS upgrade re-checks membership on every connect so a
user removed from an org loses the live socket without waiting for token
expiry. The check is cached for ``MEMBERSHIP_CACHE_TTL`` seconds via the
ops-tier Valkey client; the membership mutation paths in
``ContentMembersOperations`` and ``OrganizationOperations`` already
invalidate by user+org tag on commit.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.valkey.cache import CACHE_MISS, cache_get, cache_set

MEMBERSHIP_CACHE_TTL = 30


def _membership_cache_key(user_id: UUID, organization_id: UUID) -> str:
    return f"auth:membership:{user_id}:{organization_id}"


async def _load_active(session: AsyncSession, user_id: UUID, organization_id: UUID) -> bool:
    from uniffy.core.models.login.organization import Organization
    from uniffy.core.models.login.organization_member import OrganizationMember

    org = (
        await session.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if not org or org.deleted_at is not None or org.is_suspended:
        return False
    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    return bool(membership and membership.is_active)


async def is_active_member(
    user_id: UUID,
    organization_id: UUID,
    session: AsyncSession | None = None,
) -> bool:
    """Return True if the user is still an active member of the org.

    Reads through a 30s Valkey cache; falls through to PG on cache miss
    (and on any cache fault since the ops tier fails fast). Callers that
    already hold a session pass it in; otherwise one is opened.
    """
    key = _membership_cache_key(user_id, organization_id)
    cached = await cache_get(key)
    if cached is not CACHE_MISS:
        return bool(cached and cached.get("active"))

    if session is not None:
        active = await _load_active(session, user_id, organization_id)
    else:
        from uniffy.db import open_session

        async with open_session() as owned:
            active = await _load_active(owned, user_id, organization_id)

    await cache_set(key, {"active": active}, ttl=MEMBERSHIP_CACHE_TTL)
    return active


async def invalidate_membership_cache(
    user_id: UUID,
    organization_id: UUID,
) -> None:
    """Drop the cached membership decision after a mutation."""
    from uniffy.core.valkey.cache import cache_delete

    await cache_delete(_membership_cache_key(user_id, organization_id))
