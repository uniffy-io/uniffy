"""Agent and image-generation rate-limit policy with per-org overrides."""

import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.rate_limit import check_rate_limit

logger = logger.bind(component="agents.limits.policy")

AGENT_MSG_USER = "AGENT_MSG_USER"
AGENT_MSG_ORG = "AGENT_MSG_ORG"
AGENT_MSG_AGENT = "AGENT_MSG_AGENT"
IMAGE_GEN_USER = "IMAGE_GEN_USER"
IMAGE_GEN_ORG = "IMAGE_GEN_ORG"

ALL_LIMIT_KINDS: tuple[str, ...] = (
    AGENT_MSG_USER,
    AGENT_MSG_ORG,
    AGENT_MSG_AGENT,
    IMAGE_GEN_USER,
    IMAGE_GEN_ORG,
)


@dataclass(frozen=True)
class LimitConfig:
    """``(limit, window_seconds)`` for one bucket kind."""

    limit: int
    window_seconds: int


DEFAULT_LIMITS: dict[str, LimitConfig] = {
    AGENT_MSG_USER: LimitConfig(limit=30, window_seconds=60),
    AGENT_MSG_ORG: LimitConfig(limit=200, window_seconds=60),
    AGENT_MSG_AGENT: LimitConfig(limit=60, window_seconds=60),
    IMAGE_GEN_USER: LimitConfig(limit=5, window_seconds=60),
    IMAGE_GEN_ORG: LimitConfig(limit=20, window_seconds=60),
}

DEFAULT_USER_LIMIT = DEFAULT_LIMITS[AGENT_MSG_USER].limit
DEFAULT_USER_WINDOW_SECONDS = DEFAULT_LIMITS[AGENT_MSG_USER].window_seconds
DEFAULT_ORG_LIMIT = DEFAULT_LIMITS[AGENT_MSG_ORG].limit
DEFAULT_ORG_WINDOW_SECONDS = DEFAULT_LIMITS[AGENT_MSG_ORG].window_seconds

_CACHE_TTL_SECONDS = 30.0
_overrides_cache: dict[UUID, tuple[float, dict[str, LimitConfig]]] = {}


async def load_org_overrides(
    session: AsyncSession,
    organization_id: UUID,
) -> dict[str, LimitConfig]:
    """Per-org rate-limit overrides through a short TTL cache; absent rows fall back to defaults."""
    now = time.monotonic()
    cached = _overrides_cache.get(organization_id)
    if cached is not None and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    from uniffy.core.models.agents.rate_limit_config import AgentRateLimitConfig

    try:
        result = await session.execute(
            select(AgentRateLimitConfig).where(
                AgentRateLimitConfig.organization_id == organization_id,
            )
        )
        rows = list(result.scalars().all())
    except Exception:
        logger.warning(
            "Failed to load rate limit overrides, using defaults",
            organization_id=str(organization_id),
        )
        return {}

    overrides: dict[str, LimitConfig] = {
        row.limit_kind: LimitConfig(limit=row.limit, window_seconds=row.window_seconds)
        for row in rows
    }
    _overrides_cache[organization_id] = (now, overrides)
    return overrides


def invalidate_overrides_cache(organization_id: UUID | None = None) -> None:
    """Drop cached overrides for one org (or all when ``None``); called after every write."""
    if organization_id is None:
        _overrides_cache.clear()
    else:
        _overrides_cache.pop(organization_id, None)


def resolve_limit(
    limit_kind: str,
    overrides: dict[str, LimitConfig],
) -> LimitConfig:
    """Override for ``limit_kind`` or the default."""
    if limit_kind in overrides:
        return overrides[limit_kind]
    return DEFAULT_LIMITS[limit_kind]


async def check_agent_message_limits(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    agent_id: UUID,
) -> None:
    """Check user / org / agent buckets for an agent-message send before any expensive work."""
    overrides = await load_org_overrides(session, organization_id)

    user_cfg = resolve_limit(AGENT_MSG_USER, overrides)
    await check_rate_limit(
        key=f"rl:agent_msg:user:{user_id}",
        limit=user_cfg.limit,
        window_seconds=user_cfg.window_seconds,
        resource="agent messages (per user)",
    )

    org_cfg = resolve_limit(AGENT_MSG_ORG, overrides)
    await check_rate_limit(
        key=f"rl:agent_msg:org:{organization_id}",
        limit=org_cfg.limit,
        window_seconds=org_cfg.window_seconds,
        resource="agent messages (per organization)",
    )

    agent_cfg = resolve_limit(AGENT_MSG_AGENT, overrides)
    await check_rate_limit(
        key=f"rl:agent_msg:agent:{user_id}:{agent_id}",
        limit=agent_cfg.limit,
        window_seconds=agent_cfg.window_seconds,
        resource="agent messages (per agent)",
    )


async def check_image_generation_limits(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    """Check user / org buckets for an image generation; tighter caps than text."""
    overrides = await load_org_overrides(session, organization_id)

    user_cfg = resolve_limit(IMAGE_GEN_USER, overrides)
    await check_rate_limit(
        key=f"rl:image_gen:user:{user_id}",
        limit=user_cfg.limit,
        window_seconds=user_cfg.window_seconds,
        resource="image generation (per user)",
    )

    org_cfg = resolve_limit(IMAGE_GEN_ORG, overrides)
    await check_rate_limit(
        key=f"rl:image_gen:org:{organization_id}",
        limit=org_cfg.limit,
        window_seconds=org_cfg.window_seconds,
        resource="image generation (per organization)",
    )
