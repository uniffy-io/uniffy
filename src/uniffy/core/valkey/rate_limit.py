"""Rate limiting via Valkey fixed-window counters.

Uses atomic INCR + EXPIRE on the shared Pub/Sub publisher connection.
All low-level operations are non-fatal: if Valkey is unavailable,
requests are allowed through with a warning log.

The agents domain uses five logical buckets:

- ``AGENT_MSG_USER`` - per-user quota on text messages
- ``AGENT_MSG_ORG`` - per-organization quota on text messages
- ``AGENT_MSG_AGENT`` - per-agent-per-user quota (prevents a runaway
  loop on a single agent starving other agents the user owns)
- ``IMAGE_GEN_USER`` - per-user quota on image generations
- ``IMAGE_GEN_ORG`` - per-organization quota on image generations

Each bucket has module-level defaults (used when no per-organization
override exists). Organizations can override any subset of the five
kinds by writing rows to ``agents_rate_limits``; overrides are loaded
via ``load_org_overrides`` with a small process-local TTL cache.
"""

import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import RateLimitExceededError

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
    """A single ``(limit, window_seconds)`` tuple for one bucket kind."""

    limit: int
    window_seconds: int


DEFAULT_LIMITS: dict[str, LimitConfig] = {
    AGENT_MSG_USER: LimitConfig(limit=30, window_seconds=60),
    AGENT_MSG_ORG: LimitConfig(limit=200, window_seconds=60),
    AGENT_MSG_AGENT: LimitConfig(limit=60, window_seconds=60),
    IMAGE_GEN_USER: LimitConfig(limit=5, window_seconds=60),
    IMAGE_GEN_ORG: LimitConfig(limit=20, window_seconds=60),
}

# Legacy names kept so callers that only care about the text-message
# defaults can still import them directly.
DEFAULT_USER_LIMIT = DEFAULT_LIMITS[AGENT_MSG_USER].limit
DEFAULT_USER_WINDOW_SECONDS = DEFAULT_LIMITS[AGENT_MSG_USER].window_seconds
DEFAULT_ORG_LIMIT = DEFAULT_LIMITS[AGENT_MSG_ORG].limit
DEFAULT_ORG_WINDOW_SECONDS = DEFAULT_LIMITS[AGENT_MSG_ORG].window_seconds

_CACHE_TTL_SECONDS = 30.0
_overrides_cache: dict[UUID, tuple[float, dict[str, LimitConfig]]] = {}


def _get_client():
    """Return the Pub/Sub publisher connection (lazy import to avoid cycles)."""
    from uniffy.core.valkey.pubsub import _publisher

    return _publisher


async def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
    resource: str = "request",
) -> None:
    """Check and increment a rate limit counter.

    Uses Valkey INCR + EXPIRE for a fixed-window counter.
    Raises RateLimitExceededError if the limit is exceeded.
    Degrades gracefully if Valkey is unavailable.

    Parameters
    ----------
    key : str
        The rate limit key (e.g., "rl:agent_msg:user:{user_id}").
    limit : int
        Maximum allowed requests in the window.
    window_seconds : int
        Duration of the window in seconds.
    resource : str
        Human-readable resource name for error messages.

    Raises
    ------
    RateLimitExceededError
        If the rate limit is exceeded.

    """
    client = _get_client()
    if client is None:
        logger.warning(
            "Rate limit check skipped: Valkey not available",
            component="rate_limit",
        )
        return

    try:
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)

        if count > limit:
            ttl = await client.ttl(key)
            retry_after = max(ttl, 1)
            raise RateLimitExceededError(
                resource=resource,
                limit=limit,
                window_seconds=window_seconds,
                retry_after=retry_after,
            )
    except RateLimitExceededError:
        raise
    except Exception:
        logger.warning(
            "Rate limit check failed, allowing request",
            component="rate_limit",
        )


async def load_org_overrides(
    session: AsyncSession,
    organization_id: UUID,
) -> dict[str, LimitConfig]:
    """Load per-organization rate limit overrides with a short TTL cache.

    Absent rows are fine - callers must fall back to ``DEFAULT_LIMITS``.
    Database errors degrade gracefully: we log and return an empty dict
    so the request can still proceed under the defaults.

    Parameters
    ----------
    session : AsyncSession
        Database session to read overrides from.
    organization_id : UUID
        Organization whose overrides to load.

    Returns
    -------
    dict[str, LimitConfig]
        Map of ``limit_kind`` to ``LimitConfig`` for each override row.

    """
    now = time.monotonic()
    cached = _overrides_cache.get(organization_id)
    if cached is not None and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    # Lazy import to avoid pulling models at module import time.
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
            component="rate_limit",
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
    """Drop the cached overrides for one org (or all orgs when ``None``).

    Called by the RateLimitsService after a write so a freshly saved
    override takes effect within a single request rather than after the
    TTL expires.
    """
    if organization_id is None:
        _overrides_cache.clear()
    else:
        _overrides_cache.pop(organization_id, None)


def resolve_limit(
    limit_kind: str,
    overrides: dict[str, LimitConfig],
) -> LimitConfig:
    """Return the override for ``limit_kind`` or fall back to the default."""
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
    """Check user / org / agent buckets for an agent-message send.

    Called from ``RuntimeOperations.send_message`` and
    ``stream_send_message`` before any expensive work. Raises
    ``RateLimitExceededError`` on the first bucket that is exceeded.

    Parameters
    ----------
    session : AsyncSession
        Database session, used to read per-org overrides.
    user_id : UUID
        The human user sending the message.
    organization_id : UUID
        Organization scope for the send.
    agent_id : UUID
        The agent being sent to.

    Raises
    ------
    RateLimitExceededError
        If any of the three buckets is exhausted. The error's
        ``resource`` field identifies which bucket tripped and
        ``retry_after`` reports the remaining window.

    """
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
    """Check user / org buckets for an image generation call.

    Image generation is orders of magnitude more expensive than a text
    turn, so we default to much tighter limits than agent messages. The
    buckets are independent from the text buckets - hitting the image
    cap does not block text sends.

    Parameters
    ----------
    session : AsyncSession
        Database session, used to read per-org overrides.
    user_id : UUID
        The human user invoking ``images.generate_image``.
    organization_id : UUID
        Organization scope.

    Raises
    ------
    RateLimitExceededError
        If the user or org image bucket is exhausted.

    """
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


async def check_agent_rate_limits(
    user_id: str,
    organization_id: str,
) -> None:
    """Deprecated wrapper retained for callers not on the new signature.

    Uses only the user+org defaults. New code must use
    ``check_agent_message_limits`` so the per-agent bucket and the
    per-organization overrides are applied. This wrapper is intentionally
    stateless (no DB lookup) so it can still be used from code paths that
    do not have an ``AsyncSession`` on hand.
    """
    cfg_user = DEFAULT_LIMITS[AGENT_MSG_USER]
    cfg_org = DEFAULT_LIMITS[AGENT_MSG_ORG]
    await check_rate_limit(
        key=f"rl:agent_msg:user:{user_id}",
        limit=cfg_user.limit,
        window_seconds=cfg_user.window_seconds,
        resource="agent messages (per user)",
    )
    await check_rate_limit(
        key=f"rl:agent_msg:org:{organization_id}",
        limit=cfg_org.limit,
        window_seconds=cfg_org.window_seconds,
        resource="agent messages (per organization)",
    )
