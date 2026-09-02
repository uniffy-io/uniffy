"""ARQ configuration for the egress worker fleet."""

import os
from datetime import UTC

from uniffy.core.jobs import QueueName
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.workers.lifecycle import (
    EGRESS_RESOURCE_PROFILE,
    egress_on_shutdown,
    egress_on_startup,
    on_health_check,
    on_job_end,
    on_job_rejected,
    on_job_start,
)
from uniffy.workers.registry import EGRESS_CRON_JOBS, EGRESS_JOBS

_valkey_settings = ValkeyConfig.from_env().to_arq_valkey_settings()
_job_timeout = int(os.getenv("EGRESS_WORKER_JOB_TIMEOUT", "900"))
_keep_result = int(os.getenv("WORKER_KEEP_RESULT", "3600"))
_max_tries = int(os.getenv("WORKER_MAX_TRIES", "3"))
_health_check_interval = int(os.getenv("WORKER_HEALTH_CHECK_INTERVAL", "30"))


class EgressWorkerSettings:
    """Egress worker fleet: outbound LLM and slow I/O jobs."""

    timezone = UTC
    queue_name = QueueName.EGRESS.valkey_name
    resource_profile = EGRESS_RESOURCE_PROFILE
    functions = list(EGRESS_JOBS)
    cron_jobs = list(EGRESS_CRON_JOBS)
    on_startup = egress_on_startup
    on_shutdown = egress_on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end
    on_job_rejected = on_job_rejected
    on_health_check = on_health_check
    valkey_settings = _valkey_settings
    max_jobs = int(os.getenv("EGRESS_WORKER_MAX_JOBS", "50"))
    job_timeout = _job_timeout
    keep_result = _keep_result
    poll_delay = float(os.getenv("EGRESS_WORKER_POLL_DELAY", "0.05"))
    max_tries = _max_tries
    health_check_interval = _health_check_interval
