"""Prometheus instruments and the `/metrics` renderer.

When `PROMETHEUS_MULTIPROC_DIR` is set (see
`uniffy._metrics_bootstrap.bootstrap_multiproc_metrics`), counters and
histograms aggregate across forked workers via `MultiProcessCollector`. Gauges
use `multiprocess_mode='livesum'` so per-process values sum across live workers.
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

AUDIT_ROLE_LOOKUP_SECONDS = Histogram(
    "uniffy_audit_role_lookup_duration_seconds",
    "Duration of the per-write OrganizationMember role lookup performed by "
    "audit.write_audit_event. Tracked so the no-cache decision can be "
    "revisited if p99 ever drifts.",
    buckets=(0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)

_db_pool: Any = None


def register_db_pool(pool: Any) -> None:
    """Store the SQLAlchemy pool so its stats can be scraped lazily."""
    global _db_pool
    _db_pool = pool


def _update_pool_gauges() -> None:
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


ORG_DEK_CACHE_HIT_TOTAL = Counter(
    "uniffy_org_dek_cache_hit_total",
    "In-process per-org DEK LRU hits (no master-unwrap needed)",
)

ORG_DEK_CACHE_MISS_TOTAL = Counter(
    "uniffy_org_dek_cache_miss_total",
    "In-process per-org DEK LRU misses (master-unwrap ran)",
)

ORG_DEK_UNWRAP_SECONDS = Histogram(
    "uniffy_org_dek_unwrap_seconds",
    "Wall time spent unwrapping a per-org DEK with the master cipher",
)


DEPLOYMENT_DEK_CACHE_HIT_TOTAL = Counter(
    "uniffy_deployment_dek_cache_hit_total",
    "In-process deployment-singleton DEK cache hits (no master-unwrap needed)",
)

DEPLOYMENT_DEK_CACHE_MISS_TOTAL = Counter(
    "uniffy_deployment_dek_cache_miss_total",
    "In-process deployment-singleton DEK cache misses (master-unwrap ran)",
)

DEPLOYMENT_DEK_UNWRAP_SECONDS = Histogram(
    "uniffy_deployment_dek_unwrap_seconds",
    "Wall time spent unwrapping the deployment-singleton DEK with the master cipher",
)


REALTIME_ACTIVE_DOCS = Gauge(
    "uniffy_realtime_active_docs",
    "Yjs documents currently hydrated in this replica's YDocManager",
    ["content_type"],
    multiprocess_mode="livesum",
)

REALTIME_ACTIVE_CLIENTS = Gauge(
    "uniffy_realtime_active_clients",
    "Realtime client handles attached on this replica (one per WS per doc)",
    ["content_type"],
    multiprocess_mode="livesum",
)

REALTIME_HYDRATION_DURATION = Histogram(
    "uniffy_realtime_hydration_duration_seconds",
    "Time to hydrate a fresh YDoc on first acquire",
    ["content_type", "source"],
)

REALTIME_SNAPSHOT_DURATION = Histogram(
    "uniffy_realtime_snapshot_duration_seconds",
    "Time to encode + enqueue a debounced snapshot from the web replica",
    ["content_type"],
)

REALTIME_SNAPSHOT_TASK_DURATION = Histogram(
    "uniffy_realtime_snapshot_task_duration_seconds",
    "End-to-end time of the save_realtime_snapshot ARQ task (UPSERT + adapter render)",
    ["content_type"],
)

REALTIME_SNAPSHOT_DROPPED_TOTAL = Counter(
    "uniffy_realtime_snapshot_dropped_total",
    "Snapshot attempts that did not result in a persisted row",
    ["content_type", "reason"],
)

REALTIME_UPDATE_MESSAGES_TOTAL = Counter(
    "uniffy_realtime_update_messages_total",
    "Yjs SYNC update frames observed per direction",
    ["content_type", "direction"],
)

REALTIME_AWARENESS_MESSAGES_TOTAL = Counter(
    "uniffy_realtime_awareness_messages_total",
    "y-protocols AWARENESS frames echoed across realtime sessions",
    ["content_type"],
)

REALTIME_PUBSUB_LATENCY = Histogram(
    "uniffy_realtime_pubsub_latency_seconds",
    "Latency from publish to in-process router dispatch on this replica",
    ["channel"],
)

REALTIME_PUBSUB_RECONNECTS_TOTAL = Counter(
    "uniffy_realtime_pubsub_reconnects_total",
    "Router pattern subscribers that crashed and re-attached",
    ["pattern"],
)

REALTIME_FRAMES_DROPPED_TOTAL = Counter(
    "uniffy_realtime_frames_dropped_total",
    "Realtime frames dropped before reaching their destination",
    ["kind"],
)

REALTIME_PERMISSION_REJECTIONS_TOTAL = Counter(
    "uniffy_realtime_permission_rejections_total",
    "Realtime sessions / frames rejected by permission checks",
    ["content_type", "reason"],
)

REALTIME_AUTH_FAILURES_TOTAL = Counter(
    "uniffy_realtime_auth_failures_total",
    "Realtime WebSocket upgrades that failed authentication or origin checks",
    ["reason"],
)


def _build_multiproc_registry() -> CollectorRegistry:
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    return registry


def get_metrics() -> bytes:
    """Render Prometheus metrics, aggregating across workers in multiproc mode."""
    _update_pool_gauges()
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return generate_latest(_build_multiproc_registry())
    return generate_latest()


def start_worker_metrics_server(port: int | None = None) -> None:
    """Expose `/metrics` over HTTP from a worker process.

    Non-fatal on bind failure - the worker keeps running without metrics. Each
    worker fleet passes its own port to avoid socket collisions.
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
    """Drop this pid from livesum gauges so an exited worker stops contributing."""
    if not os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        return
    with contextlib.suppress(Exception):
        multiprocess.mark_process_dead(os.getpid())


if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
    atexit.register(_mark_process_dead_at_exit)
