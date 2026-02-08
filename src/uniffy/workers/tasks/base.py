"""
Base task utilities and lifecycle hooks.

Provides shared context for all background tasks including
database sessions, S3 client, and Meilisearch client.
"""

import time
from typing import Any

from loguru import logger

from uniffy.core.pubsub import close_pubsub, init_pubsub
from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
from uniffy.db import close_db, init_db
from uniffy.observability.metrics import (
    WORKER_JOB_DURATION,
    WORKER_JOBS_COMPLETED_TOTAL,
    WORKER_JOBS_IN_PROGRESS,
    WORKER_JOBS_STARTED_TOTAL,
    start_worker_metrics_server,
)


async def on_startup(ctx: dict[str, Any]) -> None:
    """
    Initialize shared resources when worker starts.

    Sets up database, S3, and Meilisearch connections
    that will be shared across all jobs in this worker process.

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary for storing shared resources.

    """
    logger.info("Worker starting up - initializing resources...")

    # Start Prometheus metrics HTTP server for the worker process
    try:
        start_worker_metrics_server()
    except Exception as e:
        logger.warning(f"Worker: Metrics server not available: {e}")

    # Initialize database connection pool (skip migrations - backend handles those)
    await init_db(skip_migrations=True)
    logger.info("Worker: Database initialized")

    # Initialize S3 storage client
    await init_s3()
    logger.info("Worker: S3 storage initialized")

    # Initialize Meilisearch client
    await init_meilisearch()
    logger.info("Worker: Meilisearch initialized")

    # Initialize Pub/Sub publisher for notification delivery
    try:
        await init_pubsub()
        logger.info("Worker: Pub/Sub initialized")
    except Exception as e:
        logger.warning(f"Worker: Pub/Sub not available: {e}")

    logger.info("Worker startup complete")


async def on_shutdown(ctx: dict[str, Any]) -> None:
    """
    Cleanup resources when worker shuts down.

    Gracefully closes all connections established during startup.

    Parameters
    ----------
    ctx : dict
        ARQ context dictionary.

    """
    logger.info("Worker shutting down - cleaning up resources...")

    await close_pubsub()
    await close_meilisearch()
    await close_s3()
    await close_db()

    logger.info("Worker shutdown complete")


async def on_job_start(ctx: dict[str, Any]) -> None:
    """
    Called before each job starts.

    Logs job start and records metrics for debugging and monitoring.

    Parameters
    ----------
    ctx : dict
        ARQ context with job metadata.

    """
    job_name = ctx.get("job_name", "unknown")
    WORKER_JOBS_STARTED_TOTAL.labels(job_name=job_name).inc()
    WORKER_JOBS_IN_PROGRESS.labels(job_name=job_name).inc()
    ctx["_metrics_start_time"] = time.perf_counter()

    logger.info(
        f"Starting job {ctx.get('job_id', 'unknown')} "
        f"(function: {job_name}, try: {ctx.get('job_try', 1)})"
    )


async def on_job_end(ctx: dict[str, Any]) -> None:
    """
    Called after each job completes.

    Logs job completion and records duration/status metrics.

    Parameters
    ----------
    ctx : dict
        ARQ context with job metadata.

    """
    job_name = ctx.get("job_name", "unknown")
    WORKER_JOBS_IN_PROGRESS.labels(job_name=job_name).dec()

    start_time = ctx.get("_metrics_start_time")
    if start_time is not None:
        duration = time.perf_counter() - start_time
        WORKER_JOB_DURATION.labels(job_name=job_name).observe(duration)

    status = "success" if ctx.get("result") is not None else "error"
    WORKER_JOBS_COMPLETED_TOTAL.labels(job_name=job_name, status=status).inc()

    logger.info(f"Completed job {ctx.get('job_id', 'unknown')}")
