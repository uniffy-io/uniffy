"""Prometheus metrics instruments for UNIFFY.

All application-level metrics are defined here. Import the instruments you need
from this module and call `get_metrics()` to render the Prometheus text format.

When PROMETHEUS_MULTIPROC_DIR is set (managed by
`uniffy._metrics_bootstrap.bootstrap_multiproc_metrics`), counters and
histograms are aggregated across forked worker processes by
prometheus_client's MultiProcessCollector. Gauges are tagged with
`multiprocess_mode='livesum'` so the per-process value sums across live
workers - the right semantics for "active connections", "pool checkouts",
"jobs in progress", and similar.
"""

import atexit
import contextlib
import os
from typing import Any

from loguru import logger
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)

PUBSUB_ACTIVE_SUBSCRIBERS = Gauge(
    "uniffy_pubsub_active_subscribers",
    "Number of active Pub/Sub streaming connections",
    multiprocess_mode="livesum",
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
    multiprocess_mode="livesum",
)

DB_POOL_CHECKED_OUT = Gauge(
    "uniffy_db_pool_checked_out",
    "Number of connections currently checked out from the pool",
    multiprocess_mode="livesum",
)

DB_POOL_OVERFLOW = Gauge(
    "uniffy_db_pool_overflow",
    "Number of overflow connections currently in use",
    multiprocess_mode="livesum",
)

DB_POOL_CHECKED_IN = Gauge(
    "uniffy_db_pool_checked_in",
    "Number of connections currently idle in the pool",
    multiprocess_mode="livesum",
)

DB_POOL_TIMEOUT_TOTAL = Counter(
    "uniffy_db_pool_timeout_total",
    "SQLAlchemy pool checkout timeouts (request waited past DB_POOL_TIMEOUT)",
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
    ["queue", "job_name"],
)

WORKER_JOBS_COMPLETED_TOTAL = Counter(
    "uniffy_worker_jobs_completed_total",
    "Total worker jobs completed",
    ["queue", "job_name", "status"],
)

WORKER_JOB_DURATION = Histogram(
    "uniffy_worker_job_duration_seconds",
    "Worker job duration in seconds",
    ["queue", "job_name"],
)

WORKER_JOBS_IN_PROGRESS = Gauge(
    "uniffy_worker_jobs_in_progress",
    "Number of worker jobs currently in progress",
    ["queue", "job_name"],
    multiprocess_mode="livesum",
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


APPROVAL_STORE_PENDING_SIZE = Gauge(
    "uniffy_approval_store_pending_size",
    "In-process pending approvals awaiting user decision",
    multiprocess_mode="livesum",
)

APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL = Counter(
    "uniffy_approval_store_valkey_unreachable_total",
    "Approval-store Valkey operations that failed and were swallowed",
    ["op"],
)


CACHE_HIT_TOTAL = Counter(
    "uniffy_cache_hit_total",
    "Valkey cache hits per namespace",
    ["namespace"],
)

CACHE_MISS_TOTAL = Counter(
    "uniffy_cache_miss_total",
    "Valkey cache misses per namespace",
    ["namespace"],
)

CACHE_SET_TOTAL = Counter(
    "uniffy_cache_set_total",
    "Valkey cache writes per namespace",
    ["namespace"],
)

CACHE_INVALIDATE_TOTAL = Counter(
    "uniffy_cache_invalidate_total",
    "Valkey cache invalidations per namespace",
    ["namespace"],
)

CACHE_LOAD_DURATION = Histogram(
    "uniffy_cache_load_duration_seconds",
    "Cache loader duration on miss, per namespace",
    ["namespace"],
)

CACHE_STAMPEDE_LOCK_WAIT_TOTAL = Counter(
    "uniffy_cache_stampede_lock_wait_total",
    "Number of callers that waited for a cache stampede lock, per namespace",
    ["namespace"],
)

CACHE_OP_TIMEOUT_TOTAL = Counter(
    "uniffy_cache_op_timeout_total",
    "Valkey ops-client calls that tripped the per-call deadline guard",
    ["namespace", "op"],
)

AGENT_RUN_QUEUE_LAG = Histogram(
    "uniffy_agent_run_queue_lag_seconds",
    "Time from agent run enqueue (queued_at) to worker pickup (started_at)",
)

AGENT_RUN_DURATION = Histogram(
    "uniffy_agent_run_duration_seconds",
    "Agent run total duration from worker pickup to done/error",
)

AGENT_RUN_ACTIVE = Gauge(
    "uniffy_agent_run_active",
    "Agent runs currently executing in the egress worker fleet",
    multiprocess_mode="livesum",
)

AGENT_RUN_ENQUEUE_FAILURES_TOTAL = Counter(
    "uniffy_agent_run_enqueue_failures_total",
    "Agent run enqueue failures (Valkey down at the handler boundary)",
)

AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL = Counter(
    "uniffy_agent_run_subscribe_timeout_total",
    "Handler XREAD subscribe loops that hit the 120s wall budget",
)

AGENT_RUN_RECONNECT_TOTAL = Counter(
    "uniffy_agent_run_reconnect_total",
    "SubscribeToRun calls that resumed an in-flight run",
)


LLM_PROVIDER_LRU_HIT_TOTAL = Counter(
    "uniffy_llm_provider_lru_hit_total",
    "In-process LLM-provider-client LRU hits (decrypt + construct skipped)",
)

LLM_PROVIDER_LRU_MISS_TOTAL = Counter(
    "uniffy_llm_provider_lru_miss_total",
    "In-process LLM-provider-client LRU misses (decrypt + construct ran)",
)


def _build_multiproc_registry() -> CollectorRegistry:
    """Return a fresh registry attached to a MultiProcessCollector."""
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    return registry


def get_metrics() -> bytes:
    """Render all registered Prometheus metrics in text exposition format.

    In multiprocess mode (PROMETHEUS_MULTIPROC_DIR set) collects per-pid
    files via MultiProcessCollector so the scrape returns an aggregate view
    across every live Granian worker. Falls back to the default in-process
    registry when the env var is unset (tests, single-proc runs).
    """
    _update_pool_gauges()
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return generate_latest(_build_multiproc_registry())
    return generate_latest()


def start_worker_metrics_server(port: int | None = None) -> None:
    """Start a lightweight HTTP server exposing /metrics for the worker process.

    Uses prometheus_client.start_http_server which spawns a daemon thread.
    Non-fatal: if the port is busy or unavailable the worker continues
    without metrics exposure.

    In multiprocess mode the served registry is backed by
    MultiProcessCollector against the worker's own multiproc directory, so
    a scrape returns the aggregate across whatever processes share that
    directory (today: just the ARQ worker; the backend has its own dir).

    Parameters
    ----------
    port : int | None
        Listen port. ``None`` falls back to ``WORKER_METRICS_PORT`` then
        ``9091``. The core / egress entry points pass their fleet's
        port explicitly so the two workers don't collide on one socket.

    """
    from prometheus_client import start_http_server

    if port is None:
        port = int(os.getenv("WORKER_METRICS_PORT", "9091"))
    kwargs: dict[str, Any] = {}
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        kwargs["registry"] = _build_multiproc_registry()
    try:
        start_http_server(port, **kwargs)
        logger.info(f"Worker metrics server started on :{port}")
    except OSError as exc:
        logger.warning(f"Could not start worker metrics server on :{port}: {exc}")


def _mark_process_dead_at_exit() -> None:
    """Tell MultiProcessCollector this pid is gone so livesum gauges drop it.

    Without this, a worker that exits leaves stale .db files behind whose
    gauge values the collector still treats as "alive" until file cleanup.
    Counters and histograms remain valid (they are sums over historical
    values, not point-in-time state).
    """
    if not os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return
    with contextlib.suppress(Exception):
        multiprocess.mark_process_dead(os.getpid())


if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
    atexit.register(_mark_process_dead_at_exit)
