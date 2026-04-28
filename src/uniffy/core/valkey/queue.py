"""Two-pool ARQ queue accessor.

Background work splits across two queues:

- ``core`` (``uniffy:queue:core``) -- thumbnails, extraction, content
  extraction, notifications, reminders, storage recalculation, task
  reminders, chat mute. Default ARQ tuning, tight SLA.
- ``egress`` (``uniffy:queue:egress``) -- agent runtime, agent
  compaction, agent cron, future external-API integrations. I/O bound,
  retry-heavy, slow.

Each pool is its own ``ArqRedis`` connection with a distinct
``default_queue_name`` so ``enqueue_job`` reaches the right worker
fleet without callers passing ``_queue_name`` by hand. The two pools
share the same Valkey instance.

Lazy reconnect on pool loss is preserved: ``get_queue_safe`` rebuilds
a dropped pool exactly once before returning ``None``. ``get_queue``
raises immediately so critical paths surface failures.
"""

import asyncio
from typing import Literal

from arq import create_pool
from arq.connections import ArqRedis
from loguru import logger

from uniffy.core.valkey.config import ValkeyConfig

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
    """Initialise a named queue pool.

    Parameters
    ----------
    name : QueueName
        Either ``"core"`` or ``"egress"``.

    Returns
    -------
    ArqRedis
        Connected pool with ``default_queue_name`` bound to the named
        queue so plain ``enqueue_job`` calls land on the right fleet.

    """
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
    """Close a named queue pool. Idempotent if already closed."""
    pool = _pools[name]
    if pool is None:
        return
    await pool.close(close_connection_pool=True)
    _pools[name] = None
    logger.info(f"Queue pool closed: name={name}")


async def _try_reinit_queue(name: QueueName) -> ArqRedis | None:
    """Attempt to re-initialise a dropped pool under a per-name lock."""
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
    """Return the named pool. Raises ``RuntimeError`` if not initialised."""
    pool = _pools[name]
    if pool is None:
        raise RuntimeError(
            f"Queue pool not initialized: name={name}. Call init_queue({name!r}) first."
        )
    return pool


async def get_queue_safe(name: QueueName) -> ArqRedis | None:
    """Return the named pool, attempting one reconnect on miss.

    Suitable for non-critical paths where a missing pool is logged and
    skipped rather than raised.
    """
    pool = _pools[name]
    if pool is not None:
        return pool
    return await _try_reinit_queue(name)
