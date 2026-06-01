"""Two ARQ pools - ``core`` (tight-SLA work) and ``egress`` (slow, I/O-bound, retry-heavy).

Each pool binds ``default_queue_name`` so plain ``enqueue_job`` lands on the
right fleet. ``get_queue_safe`` rebuilds a dropped pool once; ``get_queue`` raises.
"""

import asyncio
from typing import Literal

from arq import create_pool
from arq.connections import ArqRedis
from loguru import logger

from uniffy.core.valkey.config import ValkeyConfig

logger = logger.bind(component="valkey.queue")

QueueName = Literal["core", "egress"]

_QUEUE_NAMES: dict[QueueName, str] = {
    "core": "uniffy:queue:core",
    "egress": "uniffy:queue:egress",
}

_pools: dict[QueueName, ArqRedis | None] = {"core": None, "egress": None}
_reinit_locks: dict[QueueName, asyncio.Lock] = {
    "core": asyncio.Lock(),
    "egress": asyncio.Lock(),
}


async def init_queue(name: QueueName) -> ArqRedis:
    """Initialise the ``core`` or ``egress`` pool."""
    config = ValkeyConfig.from_env()
    pool = await create_pool(
        config.to_arq_redis_settings(),
        default_queue_name=_QUEUE_NAMES[name],
    )
    _pools[name] = pool
    logger.info(
        f"Queue pool initialized: name={name} queue={_QUEUE_NAMES[name]} "
        f"host={config.host}:{config.port}"
    )
    return pool


async def close_queue(name: QueueName) -> None:
    """Close a named pool. Idempotent."""
    pool = _pools[name]
    if pool is None:
        return
    await pool.close(close_connection_pool=True)
    _pools[name] = None
    logger.info(f"Queue pool closed: name={name}")


async def _try_reinit_queue(name: QueueName) -> ArqRedis | None:
    async with _reinit_locks[name]:
        pool = _pools[name]
        if pool is not None:
            try:
                await pool.ping()
                return pool
            except Exception:
                pass

        try:
            logger.warning(f"Queue pool lost (name={name}), attempting re-init...")
            return await init_queue(name)
        except Exception as exc:
            logger.error(f"Queue pool re-init failed (name={name}): {exc}")
            _pools[name] = None
            return None


def get_queue(name: QueueName) -> ArqRedis:
    """Return the named pool; raises ``RuntimeError`` if not initialised."""
    pool = _pools[name]
    if pool is None:
        raise RuntimeError(
            f"Queue pool not initialized: name={name}. Call init_queue({name!r}) first."
        )
    return pool


async def get_queue_safe(name: QueueName) -> ArqRedis | None:
    """Return the named pool; attempts one reconnect on miss, returns
    ``None`` on persistent failure.
    """
    pool = _pools[name]
    if pool is not None:
        return pool
    return await _try_reinit_queue(name)
