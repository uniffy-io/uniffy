"""Manage process resources and metrics for both ARQ worker fleets."""

import time
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from loguru import logger

from uniffy.core.crypto import (
    close_dek_invalidation_subscriber,
    subscribe_dek_invalidations,
)
from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.jobs import QueueName
from uniffy.core.search import (
    SEARCH_INDEXER_CTX_KEY,
    WORKSPACE_SEARCH_CTX_KEY,
    SearchIndexer,
    WorkspaceSearch,
)
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.domains.agents.providers.clients import (
    close_provider_invalidation_subscriber,
    init_provider_invalidation_subscriber,
)
from uniffy.domains.audit.jobs.jobs import provision_audit_partitions
from uniffy.domains.calls.channels import CallsChannelLifecycle
from uniffy.domains.chat.lifecycle import CALL_LIFECYCLE_CTX_KEY
from uniffy.domains.files.registration import register_file_content
from uniffy.domains.integrations.clients import (
    close_integration_invalidation_subscriber,
    init_integration_invalidation_subscriber,
)
from uniffy.domains.notes.adapter import register_note_realtime_adapter
from uniffy.domains.notes.registration import register_note_content
from uniffy.domains.notifications.delivery import (
    DELIVERY_ADAPTERS_CTX_KEY,
    build_delivery_adapters,
)
from uniffy.domains.projects.registration import register_project_content
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.infrastructure.database import close_db, init_db, open_session
from uniffy.infrastructure.search import MeiliSearchEngine
from uniffy.infrastructure.storage import S3Storage
from uniffy.infrastructure.valkey.ops import close_ops_client, init_ops_client
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.infrastructure.valkey.queue import close_queue, init_queue
from uniffy.vendor.arq.constants import job_start_delay_ctx_key
from uniffy.vendor.arq.typing import JobRejectionReason
from uniffy.workers.metrics import (
    WORKER_JOB_DURATION,
    WORKER_JOB_REJECTED_TOTAL,
    WORKER_JOB_START_DELAY,
    WORKER_JOBS_COMPLETED_TOTAL,
    WORKER_JOBS_IN_PROGRESS,
    WORKER_JOBS_STARTED_TOTAL,
    WORKER_LAST_HEARTBEAT_TIMESTAMP,
    WORKER_QUEUE_DEPTH,
    WORKER_READY,
)

logger = logger.bind(component="workers.lifecycle")


class WorkerResource(StrEnum):
    DATABASE = "database"
    S3 = "s3"
    MEILISEARCH = "meilisearch"
    QUEUE = "queue"
    PUBSUB = "pubsub"
    OPS = "ops"
    DEK_INVALIDATIONS = "dek_invalidations"
    VAPID = "vapid"
    AUDIT_PARTITIONS = "audit_partitions"
    DELIVERY_ADAPTERS = "delivery_adapters"
    PROVIDER_INVALIDATIONS = "provider_invalidations"
    INTEGRATION_INVALIDATIONS = "integration_invalidations"


@dataclass(frozen=True, slots=True)
class FleetResourceProfile:
    queue: QueueName
    resources: tuple[WorkerResource, ...]


_SHARED_RESOURCES = (
    WorkerResource.DATABASE,
    WorkerResource.S3,
    WorkerResource.MEILISEARCH,
    WorkerResource.QUEUE,
    WorkerResource.PUBSUB,
    WorkerResource.OPS,
    WorkerResource.DEK_INVALIDATIONS,
)
CORE_RESOURCE_PROFILE = FleetResourceProfile(
    queue=QueueName.CORE,
    resources=(
        *_SHARED_RESOURCES,
        WorkerResource.VAPID,
        WorkerResource.AUDIT_PARTITIONS,
        WorkerResource.DELIVERY_ADAPTERS,
    ),
)
EGRESS_RESOURCE_PROFILE = FleetResourceProfile(
    queue=QueueName.EGRESS,
    resources=(
        *_SHARED_RESOURCES,
        WorkerResource.PROVIDER_INVALIDATIONS,
        WorkerResource.INTEGRATION_INVALIDATIONS,
    ),
)


async def _on_startup_shared(
    ctx: dict[str, Any],
    profile: FleetResourceProfile,
) -> None:
    """Boot the resources every worker fleet needs."""
    register_calendar_content()
    register_file_content()
    register_note_content()
    register_project_content()
    queue_name = profile.queue
    ctx["queue"] = queue_name
    logger.info(f"Worker starting up (queue={queue_name})...")

    await init_db(skip_migrations=True, application_name=f"uniffy-worker-{queue_name}")
    ctx[SESSION_FACTORY_CTX_KEY] = open_session
    logger.info("Worker: Database initialized")

    storage = S3Storage()
    await storage.startup()
    ctx[OBJECT_STORAGE_CTX_KEY] = storage
    logger.info("Worker: S3 storage initialized")

    search = WorkspaceSearch(MeiliSearchEngine())
    await search.startup()
    ctx[WORKSPACE_SEARCH_CTX_KEY] = search
    search_indexer = SearchIndexer(search)
    ctx[SEARCH_INDEXER_CTX_KEY] = search_indexer
    ctx[CALL_LIFECYCLE_CTX_KEY] = CallsChannelLifecycle()
    register_note_realtime_adapter(search_indexer)
    logger.info("Worker: Search engine initialized")

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
    queue_name: QueueName = ctx.get("queue", QueueName.CORE)
    logger.info(f"Worker shutting down (queue={queue_name})...")

    try:
        await close_dek_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close DEK invalidation subscriber: {exc}")

    storage: ObjectStorage | None = ctx.pop(OBJECT_STORAGE_CTX_KEY, None)
    if storage is not None:
        try:
            await storage.shutdown()
        except Exception as exc:
            logger.warning(f"Failed to close object storage during shutdown: {exc}")

    ctx.pop(SEARCH_INDEXER_CTX_KEY, None)
    ctx.pop(CALL_LIFECYCLE_CTX_KEY, None)
    ctx.pop(SESSION_FACTORY_CTX_KEY, None)
    search: WorkspaceSearch | None = ctx.pop(WORKSPACE_SEARCH_CTX_KEY, None)
    if search is not None:
        try:
            await search.shutdown()
        except Exception as exc:
            logger.warning(f"Failed to close search engine during shutdown: {exc}")

    for name, coro in [
        ("ops_client", close_ops_client()),
        ("queue", close_queue(queue_name)),
        ("pubsub", close_pubsub()),
        ("db", close_db()),
    ]:
        try:
            await coro
        except Exception as exc:
            logger.warning("Failed to close {name} during shutdown: {exc}", name=name, exc=exc)

    logger.info(f"Worker shutdown complete (queue={queue_name})")


async def core_on_startup(ctx: dict[str, Any]) -> None:
    """Startup hook for the core fleet (shared stack + VAPID for push)."""
    await _on_startup_shared(ctx, CORE_RESOURCE_PROFILE)

    try:
        from uniffy.core.config.push import load_vapid_config

        await load_vapid_config()
        logger.info("Core worker: VAPID config loaded")
    except Exception as e:
        logger.warning(f"Core worker: VAPID config not available: {e}")

    # Cron alone would leave the window between a boot and 01:07 unprovisioned.
    await provision_audit_partitions(ctx)

    delivery_adapters = build_delivery_adapters(open_session)
    ctx[DELIVERY_ADAPTERS_CTX_KEY] = delivery_adapters
    for name, adapter in delivery_adapters.items():
        try:
            await adapter.startup()
        except Exception as exc:
            logger.error(
                "Core worker: delivery adapter startup failed (name={name}): {exc}",
                name=name,
                exc=exc,
            )
            raise
    WORKER_READY.labels(queue=QueueName.CORE).set(1)


async def core_on_shutdown(ctx: dict[str, Any]) -> None:
    WORKER_READY.labels(queue=QueueName.CORE).set(0)

    delivery_adapters = ctx.pop(DELIVERY_ADAPTERS_CTX_KEY, {})
    for name, adapter in delivery_adapters.items():
        try:
            await adapter.shutdown()
        except Exception as exc:
            logger.warning(
                "Core worker: delivery adapter shutdown failed (name={name}): {exc}",
                name=name,
                exc=exc,
            )
    await _on_shutdown_shared(ctx)


async def egress_on_startup(ctx: dict[str, Any]) -> None:
    """Startup hook for the egress fleet (shared stack + provider-key invalidation)."""
    await _on_startup_shared(ctx, EGRESS_RESOURCE_PROFILE)

    try:
        await init_provider_invalidation_subscriber()
        logger.info("Egress worker: Provider invalidation subscriber started")
    except Exception as e:
        logger.warning(f"Egress worker: Provider invalidation subscriber not available: {e}")

    try:
        await init_integration_invalidation_subscriber()
        logger.info("Egress worker: Integration invalidation subscriber started")
    except Exception as e:
        logger.warning(f"Egress worker: Integration invalidation subscriber not available: {e}")
    WORKER_READY.labels(queue=QueueName.EGRESS).set(1)


async def egress_on_shutdown(ctx: dict[str, Any]) -> None:
    WORKER_READY.labels(queue=QueueName.EGRESS).set(0)

    try:
        await close_provider_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close provider_lru_subscriber during shutdown: {exc}")
    try:
        await close_integration_invalidation_subscriber()
    except Exception as exc:
        logger.warning(f"Failed to close integration_lru_subscriber during shutdown: {exc}")
    await _on_shutdown_shared(ctx)


async def on_job_start(ctx: dict[str, Any]) -> None:
    queue_name = str(ctx.get("queue") or ctx["job_queue"])
    job_name = str(ctx["job_name"])
    WORKER_JOBS_STARTED_TOTAL.labels(queue=queue_name, job_name=job_name).inc()
    WORKER_JOBS_IN_PROGRESS.labels(queue=queue_name, job_name=job_name).inc()
    WORKER_JOB_START_DELAY.labels(queue=queue_name, job_name=job_name).observe(
        max(0, int(ctx[job_start_delay_ctx_key])) / 1000
    )
    ctx["_metrics_start_time"] = time.perf_counter()


async def on_job_end(ctx: dict[str, Any]) -> None:
    queue_name = str(ctx.get("queue") or ctx["job_queue"])
    job_name = str(ctx["job_name"])
    WORKER_JOBS_IN_PROGRESS.labels(queue=queue_name, job_name=job_name).dec()

    start_time = ctx.get("_metrics_start_time")
    if start_time is not None:
        duration = time.perf_counter() - start_time
        WORKER_JOB_DURATION.labels(queue=queue_name, job_name=job_name).observe(duration)

    status = str(ctx["job_status"])
    WORKER_JOBS_COMPLETED_TOTAL.labels(queue=queue_name, job_name=job_name, status=status).inc()


async def on_health_check(
    ctx: dict[str, Any],
    *,
    queue_depth: int,
    heartbeat_timestamp: float,
) -> None:
    queue_name = str(ctx["queue"])
    WORKER_QUEUE_DEPTH.labels(queue=queue_name).set(queue_depth)
    WORKER_LAST_HEARTBEAT_TIMESTAMP.labels(queue=queue_name).set(heartbeat_timestamp)


async def on_job_rejected(
    ctx: dict[str, Any],
    *,
    reason: JobRejectionReason,
) -> None:
    queue_name = str(ctx.get("queue") or ctx["job_queue"])
    WORKER_JOB_REJECTED_TOTAL.labels(queue=queue_name, reason=reason).inc()
