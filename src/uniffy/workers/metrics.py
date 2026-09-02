from enum import StrEnum
from typing import Final

from prometheus_client import Counter, Gauge, Histogram


class WorkerRestartReason(StrEnum):
    VALKEY_CONNECTION = "valkey_connection"
    CONNECTION = "connection"
    OS_ERROR = "os_error"
    RUNTIME_ERROR = "runtime_error"


_WORKER_DURATION_BUCKETS: Final = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
    600.0,
    900.0,
)

_WORKER_START_DELAY_BUCKETS: Final = (
    0.001,
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
)

WORKER_JOBS_STARTED_TOTAL = Counter(
    "uniffy_worker_jobs_started_total",
    "Total worker jobs started",
    ["queue", "job_name"],
)

WORKER_JOBS_COMPLETED_TOTAL = Counter(
    "uniffy_worker_jobs_completed_total",
    "Total worker job attempts finished, partitioned by outcome",
    ["queue", "job_name", "status"],
)

WORKER_JOB_DURATION = Histogram(
    "uniffy_worker_job_duration_seconds",
    "Worker job duration in seconds",
    ["queue", "job_name"],
    buckets=_WORKER_DURATION_BUCKETS,
)

WORKER_JOB_START_DELAY = Histogram(
    "uniffy_worker_job_start_delay_seconds",
    "Time from queue eligibility to worker job start",
    ["queue", "job_name"],
    buckets=_WORKER_START_DELAY_BUCKETS,
)

WORKER_JOBS_IN_PROGRESS = Gauge(
    "uniffy_worker_jobs_in_progress",
    "Number of worker jobs currently in progress",
    ["queue", "job_name"],
    multiprocess_mode="livesum",
)

WORKER_QUEUE_DEPTH = Gauge(
    "uniffy_worker_queue_depth",
    "Jobs currently present in the ARQ queue sorted set",
    ["queue"],
    multiprocess_mode="livemax",
)

WORKER_LAST_HEARTBEAT_TIMESTAMP = Gauge(
    "uniffy_worker_last_heartbeat_timestamp_seconds",
    "Unix time of the last successful ARQ worker health cycle",
    ["queue"],
    multiprocess_mode="livemostrecent",
)

WORKER_READY = Gauge(
    "uniffy_worker_ready",
    "Whether the ARQ worker fleet process completed startup and is ready",
    ["queue"],
    multiprocess_mode="livemax",
)

WORKER_RESTARTS_TOTAL = Counter(
    "uniffy_worker_restarts_total",
    "ARQ worker restart-loop entries after connection or runtime loss",
    ["queue", "reason"],
)

WORKER_JOB_REJECTED_TOTAL = Counter(
    "uniffy_worker_job_rejected_total",
    "ARQ jobs rejected before handler execution",
    ["queue", "reason"],
)
