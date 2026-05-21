"""Worker lifecycle hooks for the core and egress fleets.

Two fleets, two startup profiles:

- **Core** (``thumbnails`` / ``extraction`` / ``notifications`` /
  ``reminders`` / ``storage_recalculation`` / ``chat_mute``) loads
  the shared resources plus VAPID config (web-push delivery is
  core's job).
- **Egress** (``run_agent_session`` / ``compact_session`` /
  ``agent_chat`` / ``agent_cron``) loads the shared resources plus
  the provider-key invalidation subscriber (only relevant when
  agents are running, so core stays out of it).

Neither fleet opens the streams client -- ``stream_xread`` is the
only XREAD caller in the codebase and lives on the web pod's
handler. Workers only XADD via the ops client.

The ``ctx["queue"]`` field is set on startup so per-job metrics can
split by queue.
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
    """Startup hook for the core worker fleet.

    Loads the shared stack plus VAPID config so push notifications
    can be delivered. The provider-invalidation subscriber is NOT
    started here -- core never instantiates a provider client.
    """
    await _on_startup_shared(ctx, "core")

    try:
        from uniffy.core.config.push import load_vapid_config

        await load_vapid_config()
        logger.info("Core worker: VAPID config loaded")
    except Exception as e:
        logger.warning(f"Core worker: VAPID config not available: {e}")


async def core_on_shutdown(ctx: dict[str, Any]) -> None:
    """Shutdown hook for the core worker fleet."""
    await _on_shutdown_shared(ctx)


async def egress_on_startup(ctx: dict[str, Any]) -> None:
    """Startup hook for the egress worker fleet.

    Loads the shared stack plus the provider-key invalidation
    subscriber so the in-process ``ProviderClientLRU`` stays in
    lockstep with web pods on key updates / revocations. VAPID is
    NOT loaded here -- egress never sends push notifications.
    """
    await _on_startup_shared(ctx, "egress")

    try:
        await init_provider_invalidation_subscriber()
        logger.info("Egress worker: Provider invalidation subscriber started")
    except Exception as e:
        logger.warning(f"Egress worker: Provider invalidation subscriber not available: {e}")


async def egress_on_shutdown(ctx: dict[str, Any]) -> None:
    """Shutdown hook for the egress worker fleet."""
    try:
        await close_provider_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close provider_lru_subscriber during shutdown: {exc}")
    await _on_shutdown_shared(ctx)


async def on_job_start(ctx: dict[str, Any]) -> None:
    """Record per-queue job-start metrics and log the job."""
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
    """Record per-queue job-end metrics and log completion."""
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
