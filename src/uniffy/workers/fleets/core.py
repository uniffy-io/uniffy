"""ARQ configuration for the core worker fleet."""

import os
from datetime import UTC

from uniffy.core.jobs import QueueName
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.workers.lifecycle import (
    CORE_RESOURCE_PROFILE,
    core_on_shutdown,
    core_on_startup,
    on_health_check,
    on_job_end,
    on_job_rejected,
    on_job_start,
)
from uniffy.workers.registry import CORE_CRON_JOBS, CORE_JOBS

_valkey_settings = ValkeyConfig.from_env().to_arq_valkey_settings()
_job_timeout = int(os.getenv("WORKER_JOB_TIMEOUT", "300"))
_keep_result = int(os.getenv("WORKER_KEEP_RESULT", "3600"))
_max_tries = int(os.getenv("WORKER_MAX_TRIES", "3"))
_health_check_interval = int(os.getenv("WORKER_HEALTH_CHECK_INTERVAL", "30"))


class CoreWorkerSettings:
    """Core worker fleet: short jobs and cron schedules."""

    # Hour-pinned crons must not follow the host zone (DST double-fire/skip).
    timezone = UTC
    queue_name = QueueName.CORE.valkey_name
    resource_profile = CORE_RESOURCE_PROFILE
    functions = list(CORE_JOBS)
    cron_jobs = list(CORE_CRON_JOBS)
    on_startup = core_on_startup
    on_shutdown = core_on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end
    on_job_rejected = on_job_rejected
    on_health_check = on_health_check
    valkey_settings = _valkey_settings
    max_jobs = int(os.getenv("CORE_WORKER_MAX_JOBS", "10"))
    job_timeout = _job_timeout
    keep_result = _keep_result
    poll_delay = float(os.getenv("CORE_WORKER_POLL_DELAY", "0.5"))
    max_tries = _max_tries
    health_check_interval = _health_check_interval
