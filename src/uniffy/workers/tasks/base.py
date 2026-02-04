"""
Base task utilities and lifecycle hooks.

Provides shared context for all background tasks including
database sessions, S3 client, and Meilisearch client.
"""

from typing import Any

from loguru import logger

from uniffy.core.search import close_meilisearch, init_meilisearch
from uniffy.core.storage.s3_client import close_s3, init_s3
from uniffy.db import close_db, init_db


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

    # Initialize database connection pool (skip migrations - backend handles those)
    await init_db(skip_migrations=True)
    logger.info("Worker: Database initialized")

    # Initialize S3 storage client
    await init_s3()
    logger.info("Worker: S3 storage initialized")

    # Initialize Meilisearch client
    await init_meilisearch()
    logger.info("Worker: Meilisearch initialized")

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

    await close_meilisearch()
    await close_s3()
    await close_db()

    logger.info("Worker shutdown complete")


async def on_job_start(ctx: dict[str, Any]) -> None:
    """
    Called before each job starts.

    Logs job start for debugging and monitoring.

    Parameters
    ----------
    ctx : dict
        ARQ context with job metadata.

    """
    logger.info(
        f"Starting job {ctx.get('job_id', 'unknown')} "
        f"(function: {ctx.get('job_name', 'unknown')}, try: {ctx.get('job_try', 1)})"
    )


async def on_job_end(ctx: dict[str, Any]) -> None:
    """
    Called after each job completes.

    Logs job completion for debugging and monitoring.

    Parameters
    ----------
    ctx : dict
        ARQ context with job metadata.

    """
    logger.info(f"Completed job {ctx.get('job_id', 'unknown')}")
