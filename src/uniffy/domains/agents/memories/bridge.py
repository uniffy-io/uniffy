"""Read-only personal-memory bridge: per-user opt-in, org-gateable.

The bridge only widens the READ set of shared-space runs the opted-in user
triggers; writes stay surface-scoped no matter what.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.memory_bridge import AgentMemoryBridgeOptIn
from uniffy.core.valkey.cache import CACHE_MISS, cache_delete, cache_get, cache_set

_BRIDGE_TTL_SECONDS = 300


def _bridge_key(organization_id: UUID, user_id: UUID) -> str:
    return f"agentmembridge:{organization_id}:{user_id}"


async def is_personal_bridge_enabled(
    session: AsyncSession, *, user_id: UUID, organization_id: UUID
) -> bool:
    cached = await cache_get(_bridge_key(organization_id, user_id))
    if cached is not CACHE_MISS and cached is not None:
        return bool(cached.get("enabled"))

    row = (
        await session.execute(
            select(AgentMemoryBridgeOptIn.user_id).where(
                AgentMemoryBridgeOptIn.user_id == user_id,
                AgentMemoryBridgeOptIn.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    enabled = row is not None
    await cache_set(
        _bridge_key(organization_id, user_id),
        {"enabled": enabled},
        ttl=_BRIDGE_TTL_SECONDS,
    )
    return enabled


async def set_personal_bridge(
    session: AsyncSession, *, user_id: UUID, organization_id: UUID, enabled: bool
) -> None:
    if enabled:
        await session.execute(
            pg_insert(AgentMemoryBridgeOptIn)
            .values(
                user_id=user_id,
                organization_id=organization_id,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing()
        )
    else:
        await session.execute(
            delete(AgentMemoryBridgeOptIn).where(
                AgentMemoryBridgeOptIn.user_id == user_id,
                AgentMemoryBridgeOptIn.organization_id == organization_id,
            )
        )
    await session.commit()
    await cache_delete(_bridge_key(organization_id, user_id))
