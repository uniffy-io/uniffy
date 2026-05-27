"""Fail-fast Valkey client for cache / presence / rate-limit / mention-state.

The ops client does NOT retry: a slow Valkey is treated as a miss and the caller
falls through to PG. ``ops_call`` adds a 150ms wall-clock deadline on top of the
socket timeouts so a stuck syscall never blows the budget.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
from loguru import logger

from uniffy.core.valkey.config import ValkeyConfig
from uniffy.observability.metrics import CACHE_OP_TIMEOUT_TOTAL

CACHE_OP_TIMEOUT_SECONDS = 0.15
_INIT_PING_TIMEOUT_SECONDS = 1.0
_CLOSE_TIMEOUT_SECONDS = 1.0

LOGGER_COMPONENT = "valkey.ops"

_ops_client: aioredis.Redis | None = None


async def init_ops_client() -> None:
    """Initialise the process-wide ops client. Idempotent; a bound PING verifies the connection."""
    global _ops_client

    if _ops_client is not None:
        try:
            async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
                await _ops_client.ping()
            return
        except Exception:
            with contextlib.suppress(BaseException):
                await asyncio.wait_for(
                    _ops_client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS
                )
            _ops_client = None

    config = ValkeyConfig.from_env()
    client = aioredis.from_url(config.to_url(), **config.to_ops_kwargs())
    try:
        async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
            await client.ping()
    except Exception:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
        raise

    _ops_client = client
    logger.info("Ops client initialised", component=LOGGER_COMPONENT)


async def close_ops_client() -> None:
    """Close the ops client with a hard 1s timeout."""
    global _ops_client

    if _ops_client is None:
        return

    client = _ops_client
    _ops_client = None
    try:
        await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
    except (TimeoutError, BaseException):
        logger.warning("Ops client close timed out", component=LOGGER_COMPONENT)
    logger.info("Ops client closed", component=LOGGER_COMPONENT)


def _get_ops_client() -> aioredis.Redis | None:
    return _ops_client


@contextlib.asynccontextmanager
async def ops_call(namespace: str, op: str) -> AsyncIterator[None]:
    """150ms wall-clock deadline guard around a Valkey ops call.

    On ``TimeoutError`` the metric is bumped and the exception is re-raised so
    the calling helper can convert it into "treat as miss / no-op".
    """
    try:
        async with asyncio.timeout(CACHE_OP_TIMEOUT_SECONDS):
            yield
    except TimeoutError:
        CACHE_OP_TIMEOUT_TOTAL.labels(namespace=namespace, op=op).inc()
        raise
