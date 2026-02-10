"""Prometheus metrics instruments for UNIFFY.

All application-level metrics are defined here. Import the instruments you need
from this module and call `get_metrics()` to render the Prometheus text format.
"""

import os
from typing import Any

from loguru import logger
from prometheus_client import Counter, Gauge, Histogram, generate_latest

PUBSUB_ACTIVE_SUBSCRIBERS = Gauge(
    "uniffy_pubsub_active_subscribers",
    "Number of active Pub/Sub streaming connections",
)

RPC_REQUESTS_TOTAL = Counter(
    "uniffy_rpc_requests_total",
    "Total ConnectRPC requests",
    ["service", "method", "code"],
)

RPC_REQUEST_DURATION = Histogram(
    "uniffy_rpc_request_duration_seconds",
    "ConnectRPC request duration in seconds",
    ["service", "method"],
)

HTTP_REQUESTS_TOTAL = Counter(
    "uniffy_http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)

HTTP_REQUEST_DURATION = Histogram(
    "uniffy_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
)


DB_POOL_SIZE = Gauge(
    "uniffy_db_pool_size",
    "Configured size of the database connection pool",
)

DB_POOL_CHECKED_OUT = Gauge(
    "uniffy_db_pool_checked_out",
    "Number of connections currently checked out from the pool",
)

DB_POOL_OVERFLOW = Gauge(
    "uniffy_db_pool_overflow",
    "Number of overflow connections currently in use",
)

DB_POOL_CHECKED_IN = Gauge(
    "uniffy_db_pool_checked_in",
    "Number of connections currently idle in the pool",
)

_db_pool: Any = None


def register_db_pool(pool: Any) -> None:
    """Store a reference to the SQLAlchemy pool for lazy gauge updates."""
    global _db_pool
    _db_pool = pool


def _update_pool_gauges() -> None:
    """Read pool stats and set gauge values. Called before each scrape."""
    if _db_pool is None:
        return
    DB_POOL_SIZE.set(_db_pool.size())
    DB_POOL_CHECKED_OUT.set(_db_pool.checkedout())
    DB_POOL_OVERFLOW.set(_db_pool.overflow())
    DB_POOL_CHECKED_IN.set(_db_pool.checkedin())


S3_OPERATIONS_TOTAL = Counter(
    "uniffy_s3_operations_total",
    "Total S3 operations",
    ["operation"],
)

S3_OPERATION_DURATION = Histogram(
    "uniffy_s3_operation_duration_seconds",
    "S3 operation duration in seconds",
    ["operation"],
)

S3_OPERATION_ERRORS_TOTAL = Counter(
    "uniffy_s3_operation_errors_total",
    "Total S3 operation errors",
    ["operation"],
)

S3_BYTES_TRANSFERRED = Counter(
    "uniffy_s3_bytes_transferred_total",
    "Total bytes transferred to/from S3",
    ["direction"],
)


SEARCH_OPERATIONS_TOTAL = Counter(
    "uniffy_search_operations_total",
    "Total Meilisearch operations",
    ["operation"],
)

SEARCH_OPERATION_DURATION = Histogram(
    "uniffy_search_operation_duration_seconds",
    "Meilisearch operation duration in seconds",
    ["operation"],
)

SEARCH_OPERATION_ERRORS_TOTAL = Counter(
    "uniffy_search_operation_errors_total",
    "Total Meilisearch operation errors",
    ["operation"],
)


WORKER_JOBS_STARTED_TOTAL = Counter(
    "uniffy_worker_jobs_started_total",
    "Total worker jobs started",
    ["job_name"],
)

WORKER_JOBS_COMPLETED_TOTAL = Counter(
    "uniffy_worker_jobs_completed_total",
    "Total worker jobs completed",
    ["job_name", "status"],
)

WORKER_JOB_DURATION = Histogram(
    "uniffy_worker_job_duration_seconds",
    "Worker job duration in seconds",
    ["job_name"],
)

WORKER_JOBS_IN_PROGRESS = Gauge(
    "uniffy_worker_jobs_in_progress",
    "Number of worker jobs currently in progress",
    ["job_name"],
)


AUTH_ATTEMPTS_TOTAL = Counter(
    "uniffy_auth_attempts_total",
    "Total authentication attempts",
    ["operation", "outcome"],
)


NOTIFICATION_EVENTS_TOTAL = Counter(
    "uniffy_notification_events_total",
    "Total notification events processed",
    ["status"],
)

NOTIFICATION_DELIVERIES_TOTAL = Counter(
    "uniffy_notification_deliveries_total",
    "Total notification deliveries by channel",
    ["channel"],
)


def get_metrics() -> bytes:
    """Render all registered Prometheus metrics in text exposition format."""
    _update_pool_gauges()
    return generate_latest()


def start_worker_metrics_server() -> None:
    """Start a lightweight HTTP server exposing /metrics for the worker process.

    Uses prometheus_client.start_http_server which spawns a daemon thread.
    Non-fatal: if the port is busy or unavailable the worker continues without
    metrics exposure.
    """
    from prometheus_client import start_http_server

    port = int(os.getenv("WORKER_METRICS_PORT", "9091"))
    try:
        start_http_server(port)
        logger.info(f"Worker metrics server started on :{port}")
    except OSError as exc:
        logger.warning(f"Could not start worker metrics server on :{port}: {exc}")
