"""Per-scope mail dispatch rate limit on a fixed-minute Valkey counter.

Fail-open: a slow or unreachable Valkey returns "allowed" so an outage does not
block password-reset / digest mail.
"""

from __future__ import annotations

import time

from loguru import logger

from uniffy.core.mail.errors import MailRateLimitedError
from uniffy.core.valkey.ops import _get_ops_client, ops_call


def _window() -> int:
    return int(time.time() // 60)


async def check_send_rate_limit(scope: str, limit_per_min: int) -> None:
    """Increment the counter for ``scope`` and raise if over ``limit_per_min``."""
    if limit_per_min <= 0:
        return

    client = _get_ops_client()
    if client is None:
        return

    key = f"mail:rate:{scope}:{_window()}"
    try:
        async with ops_call("mail", "rate_limit"):
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, 120)
    except TimeoutError:
        return
    except Exception:
        logger.warning("mail rate-limit check failed; allowing", component="mail")
        return

    if count > limit_per_min:
        raise MailRateLimitedError(
            f"Mail send rate exceeded for scope {scope!r} ({count}/{limit_per_min}/min)",
            details={"scope": scope, "count": int(count), "limit": limit_per_min},
        )
