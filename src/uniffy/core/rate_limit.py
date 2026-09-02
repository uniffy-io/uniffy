"""Application rate-limit policy shared by request-producing domains."""

from loguru import logger

from uniffy.core.errors import RateLimitExceededError
from uniffy.infrastructure.valkey.rate import increment_window

logger = logger.bind(component="core.rate_limit")


async def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
    resource: str = "request",
) -> None:
    result = await increment_window(key, window_seconds)
    if result is None:
        logger.warning("Rate limit check skipped because the counter is unavailable")
        return

    count, retry_after = result
    if count > limit:
        raise RateLimitExceededError(
            resource=resource,
            limit=limit,
            window_seconds=window_seconds,
            retry_after=retry_after,
        )
