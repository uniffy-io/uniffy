"""Lifecycle hooks for the core + egress worker fleets.

Core owns short jobs and VAPID push delivery. Egress owns LLM / agent jobs and
the provider-key invalidation subscriber. Workers only XADD via the ops client;
XREAD lives on the web pod.
"""

import time
from typing import Any

from loguru import logger

from uniffy.core.crypto import (
    close_dek_invalidation_subscriber,
    subscribe_dek_invalidations,
)
from uniffy.core.llm_providers import (
    close_provider_invalidation_subscriber,
    init_provider_invalidation_subscriber,
)
from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
from uniffy.core.valkey import (
    close_ops_client,
    close_pubsub,
    close_queue,
    init_ops_client,
    init_pubsub,
    init_queue,
)
from uniffy.core.valkey.queue import QueueName
from uniffy.db import close_db, init_db
from uniffy.observability.metrics import (
    WORKER_JOB_DURATION,
    WORKER_JOBS_COMPLETED_TOTAL,
    WORKER_JOBS_IN_PROGRESS,
    WORKER_JOBS_STARTED_TOTAL,
    start_worker_metrics_server,
)


async def _on_startup_shared(ctx: dict[str, Any], queue_name: QueueName) -> None:
    """Boot the resources every worker fleet needs."""
    ctx["queue"] = queue_name
    logger.info(f"Worker starting up (queue={queue_name})...")

    try:
        start_worker_metrics_server()
    except Exception as e:
        logger.warning(f"Worker: Metrics server not available: {e}")

    await init_db(skip_migrations=True)
    logger.info("Worker: Database initialized")

    await init_s3()
    logger.info("Worker: S3 storage initialized")

    await init_meilisearch()
    logger.info("Worker: Meilisearch initialized")

    try:
        await init_queue(queue_name)
        logger.info(f"Worker: Queue pool initialized (queue={queue_name})")
    except Exception as e:
        logger.warning(f"Worker: Queue pool not available (queue={queue_name}): {e}")

    try:
        await init_pubsub()
        logger.info("Worker: Pub/Sub initialized")
    except Exception as e:
        logger.warning(f"Worker: Pub/Sub not available: {e}")

    try:
        await init_ops_client()
        logger.info("Worker: Valkey ops client initialized")
    except Exception as e:
        logger.warning(f"Worker: Valkey ops client not available: {e}")

    try:
        await subscribe_dek_invalidations()
        logger.info("Worker: Org DEK invalidation subscriber started")
    except Exception as e:
        logger.warning(f"Worker: Org DEK invalidation subscriber not available: {e}")


async def _on_shutdown_shared(ctx: dict[str, Any]) -> None:
    """Close every shared resource opened on startup, in reverse order."""
    queue_name: QueueName = ctx.get("queue", "core")
    logger.info(f"Worker shutting down (queue={queue_name})...")

    try:
        await close_dek_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close DEK invalidation subscriber: {exc}")

    for name, coro in [
        ("ops_client", close_ops_client()),
        ("queue", close_queue(queue_name)),
        ("pubsub", close_pubsub()),
        ("meilisearch", close_meilisearch()),
        ("s3", close_s3()),
        ("db", close_db()),
    ]:
        try:
            await coro
        except Exception as exc:
            logger.warning("Failed to close {name} during shutdown: {exc}", name=name, exc=exc)

    logger.info(f"Worker shutdown complete (queue={queue_name})")


async def core_on_startup(ctx: dict[str, Any]) -> None:
    """Startup hook for the core fleet (shared stack + VAPID for push)."""
    await _on_startup_shared(ctx, "core")

    try:
        from uniffy.core.config.push import load_vapid_config

        await load_vapid_config()
        logger.info("Core worker: VAPID config loaded")
    except Exception as e:
        logger.warning(f"Core worker: VAPID config not available: {e}")

    from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS

    for name, adapter in DELIVERY_ADAPTERS.items():
        try:
            await adapter.startup()
        except Exception as exc:
            logger.error(
                "Core worker: delivery adapter startup failed (name={name}): {exc}",
                name=name,
                exc=exc,
            )
            raise


async def core_on_shutdown(ctx: dict[str, Any]) -> None:
    await _on_shutdown_shared(ctx)


async def egress_on_startup(ctx: dict[str, Any]) -> None:
    """Startup hook for the egress fleet (shared stack + provider-key invalidation)."""
    await _on_startup_shared(ctx, "egress")

    try:
        await init_provider_invalidation_subscriber()
        logger.info("Egress worker: Provider invalidation subscriber started")
    except Exception as e:
        logger.warning(f"Egress worker: Provider invalidation subscriber not available: {e}")


async def egress_on_shutdown(ctx: dict[str, Any]) -> None:
    try:
        await close_provider_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close provider_lru_subscriber during shutdown: {exc}")
    await _on_shutdown_shared(ctx)


async def on_job_start(ctx: dict[str, Any]) -> None:
    queue_name = ctx.get("queue", "core")
    job_name = ctx.get("job_name", "unknown")
    WORKER_JOBS_STARTED_TOTAL.labels(queue=queue_name, job_name=job_name).inc()
    WORKER_JOBS_IN_PROGRESS.labels(queue=queue_name, job_name=job_name).inc()
    ctx["_metrics_start_time"] = time.perf_counter()

    logger.info(
        f"Starting job {ctx.get('job_id', 'unknown')} "
        f"(queue: {queue_name}, function: {job_name}, try: {ctx.get('job_try', 1)})"
    )


async def on_job_end(ctx: dict[str, Any]) -> None:
    queue_name = ctx.get("queue", "core")
    job_name = ctx.get("job_name", "unknown")
    WORKER_JOBS_IN_PROGRESS.labels(queue=queue_name, job_name=job_name).dec()

    start_time = ctx.get("_metrics_start_time")
    if start_time is not None:
        duration = time.perf_counter() - start_time
        WORKER_JOB_DURATION.labels(queue=queue_name, job_name=job_name).observe(duration)

    status = "success" if ctx.get("result") is not None else "error"
    WORKER_JOBS_COMPLETED_TOTAL.labels(
        queue=queue_name, job_name=job_name, status=status
    ).inc()

    logger.info(f"Completed job {ctx.get('job_id', 'unknown')} (queue: {queue_name})")
