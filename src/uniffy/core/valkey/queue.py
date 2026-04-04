"""
Valkey (Redis-compatible) client for background job queue.

Uses ARQ for async job processing with Valkey as the broker.
Valkey is a Redis-compatible, high-performance key-value store.

The queue pool will automatically reconnect on transient network
failures via ARQ's built-in retry settings. If the pool becomes
completely unusable, ``get_queue()`` attempts a single lazy
re-initialization before raising.
"""

import asyncio

from arq import create_pool
from arq.connections import ArqRedis
from loguru import logger

from uniffy.core.valkey.config import ValkeyConfig

# Global queue pool instance (initialized on app startup)
_queue_pool: ArqRedis | None = None

# Guard against concurrent re-init attempts
_reinit_lock = asyncio.Lock()


async def init_queue() -> ArqRedis:
    """
    Initialize the global queue pool.

    Should be called during application startup. Creates an ARQ
    connection pool to Valkey for enqueuing background jobs.

    Returns
    -------
    ArqRedis
        Initialized ARQ Redis connection pool.

    """
    global _queue_pool

    config = ValkeyConfig.from_env()
    _queue_pool = await create_pool(config.to_redis_settings())

    logger.info(f"Queue pool initialized: {config.host}:{config.port}")
    return _queue_pool


async def close_queue() -> None:
    """
    Close the global queue pool.

    Should be called during application shutdown. Gracefully
    closes all connections in the pool.

    """
    global _queue_pool

    if _queue_pool:
        await _queue_pool.close(close_connection_pool=True)
        _queue_pool = None
        logger.info("Queue pool closed")


async def _try_reinit_queue() -> ArqRedis | None:
    """Attempt to re-initialize the queue pool after a failure.

    Uses a lock to prevent concurrent re-init storms. Returns the new
    pool on success, or None if re-init fails.
    """
    global _queue_pool

    async with _reinit_lock:
        # Another coroutine may have already re-initialized while we waited
        if _queue_pool is not None:
            try:
                await _queue_pool.ping()
                return _queue_pool
            except Exception:
                pass

        try:
            logger.warning("Queue pool lost, attempting re-initialization...")
            config = ValkeyConfig.from_env()
            _queue_pool = await create_pool(config.to_redis_settings())
            logger.info("Queue pool re-initialized successfully")
            return _queue_pool
        except Exception as e:
            logger.error(f"Queue pool re-initialization failed: {e}")
            _queue_pool = None
            return None


def get_queue() -> ArqRedis:
    """
    Get the global queue pool.

    Returns
    -------
    ArqRedis
        The initialized queue pool for enqueuing jobs.

    Raises
    ------
    RuntimeError
        If pool not initialized. Call init_queue() first.

    """
    if _queue_pool is None:
        raise RuntimeError("Queue pool not initialized. Call init_queue() first.")
    return _queue_pool


async def get_queue_safe() -> ArqRedis | None:
    """
    Get the global queue pool with automatic reconnect.

    Unlike ``get_queue()``, this function attempts to re-initialize the
    pool if it is None or unresponsive. Returns None instead of raising
    when the pool cannot be recovered - suitable for non-critical paths
    (e.g. enqueuing optional background jobs).

    Returns
    -------
    ArqRedis | None
        The queue pool, or None if unavailable.

    """
    pool = _queue_pool
    if pool is not None:
        return pool
    return await _try_reinit_queue()
