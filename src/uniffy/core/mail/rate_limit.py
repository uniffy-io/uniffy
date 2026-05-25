"""Per-scope mail dispatch rate limit.

Each ``MailSender.send`` consults a Valkey token bucket keyed on
``mail:rate:{scope}:{minute_window}`` where ``scope`` is the
organization id (or ``"system"`` for env-sourced sends). The bucket is
a fixed-window counter incremented atomically with INCR + EXPIRE; on
overage ``MailRateLimitedError`` is raised so the ARQ task can re-queue
with backoff.

The implementation is fail-open: a slow or unreachable Valkey returns
"allowed" so a Valkey outage does not stop password reset / digest
mail from going out.
"""

from __future__ import annotations

import time

from loguru import logger

from uniffy.core.mail.errors import MailRateLimitedError
from uniffy.core.valkey.ops import _get_ops_client, ops_call


def _window() -> int:
    """Return the current minute bucket id (UTC-aligned)."""
    return int(time.time() // 60)


async def check_send_rate_limit(scope: str, limit_per_min: int) -> None:
    """Increment the counter for ``scope`` and raise if over ``limit_per_min``.

    ``scope`` is typically the organization UUID stringified, or
    ``"system"`` when the send uses env config. ``limit_per_min`` comes
    from the resolved ``MailConfig.rate_limit_per_min`` so per-org
    overrides take effect immediately.
    """
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
