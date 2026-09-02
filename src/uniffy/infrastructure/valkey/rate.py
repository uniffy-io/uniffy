"""Fixed-window counter operations backed by the fail-fast Valkey client."""

from loguru import logger

from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="infrastructure.valkey.rate")

_NAMESPACE = "rate_limit"


async def increment_window(key: str, window_seconds: int) -> tuple[int, int] | None:
    """Return the counter and remaining TTL, or ``None`` when Valkey is unavailable."""
    client = get_ops_client()
    if client is None:
        return None

    try:
        async with ops_call(_NAMESPACE, "increment"):
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window_seconds)
            ttl = await client.ttl(key)
        return int(count), max(int(ttl), 1)
    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"Rate-limit counter failed for {key}")
        return None
