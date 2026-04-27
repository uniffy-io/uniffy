"""Rate limiting via Valkey fixed-window counters.

Uses atomic INCR + EXPIRE on the fail-fast ops client. Operations are
non-fatal: if Valkey is unavailable or the per-call deadline trips,
the request is allowed through with a warning log.
"""

from loguru import logger

from uniffy.core.errors import RateLimitExceededError
from uniffy.core.valkey.ops import _get_ops_client, ops_call

# Default limits
DEFAULT_USER_LIMIT = 30
DEFAULT_USER_WINDOW_SECONDS = 60
DEFAULT_ORG_LIMIT = 200
DEFAULT_ORG_WINDOW_SECONDS = 60

_NAMESPACE = "rate_limit"


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
    Degrades gracefully if Valkey is unavailable or slow.
    """
    client = _get_ops_client()
    if client is None:
        logger.warning(
            "Rate limit check skipped: Valkey not available",
            component="rate_limit",
        )
        return

    try:
        async with ops_call(_NAMESPACE, "rate_limit_incr"):
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window_seconds)

        if count > limit:
            try:
                async with ops_call(_NAMESPACE, "rate_limit_ttl"):
                    ttl = await client.ttl(key)
            except TimeoutError:
                ttl = window_seconds
            retry_after = max(ttl, 1)
            raise RateLimitExceededError(
                resource=resource,
                limit=limit,
                window_seconds=window_seconds,
                retry_after=retry_after,
            )
    except RateLimitExceededError:
        raise
    except TimeoutError:
        logger.warning(
            "Rate limit check timed out, allowing request",
            component="rate_limit",
        )
    except Exception:
        logger.warning(
            "Rate limit check failed, allowing request",
            component="rate_limit",
        )


async def check_agent_rate_limits(
    user_id: str,
    organization_id: str,
) -> None:
    """Check per-user and per-org rate limits for agent messages."""
    await check_rate_limit(
        key=f"rl:agent_msg:user:{user_id}",
        limit=DEFAULT_USER_LIMIT,
        window_seconds=DEFAULT_USER_WINDOW_SECONDS,
        resource="agent messages (per user)",
    )

    await check_rate_limit(
        key=f"rl:agent_msg:org:{organization_id}",
        limit=DEFAULT_ORG_LIMIT,
        window_seconds=DEFAULT_ORG_WINDOW_SECONDS,
        resource="agent messages (per organization)",
    )
