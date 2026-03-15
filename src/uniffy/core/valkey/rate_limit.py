"""Rate limiting via Valkey fixed-window counters.

Uses atomic INCR + EXPIRE on the shared Pub/Sub publisher connection.
All operations are non-fatal: if Valkey is unavailable, requests are
allowed through with a warning log.
"""

from loguru import logger

from uniffy.core.errors import RateLimitExceededError

# Default limits
DEFAULT_USER_LIMIT = 30
DEFAULT_USER_WINDOW_SECONDS = 60
DEFAULT_ORG_LIMIT = 200
DEFAULT_ORG_WINDOW_SECONDS = 60


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


async def check_agent_rate_limits(
    user_id: str,
    organization_id: str,
) -> None:
    """Check per-user and per-org rate limits for agent messages.

    Parameters
    ----------
    user_id : str
        The user ID to rate limit.
    organization_id : str
        The organization ID to rate limit.

    Raises
    ------
    RateLimitExceededError
        If either limit is exceeded.

    """
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
