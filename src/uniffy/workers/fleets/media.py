"""ARQ configuration for media processing."""

import os
from datetime import UTC

from uniffy.core.jobs import QueueName
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.workers.lifecycle import (
    MEDIA_RESOURCE_PROFILE,
    media_on_shutdown,
    media_on_startup,
    on_health_check,
    on_job_end,
    on_job_rejected,
    on_job_start,
)
from uniffy.workers.registry import MEDIA_JOBS


class MediaWorkerSettings:
    timezone = UTC
    queue_name = QueueName.MEDIA.valkey_name
    resource_profile = MEDIA_RESOURCE_PROFILE
    functions = list(MEDIA_JOBS)
    on_startup = media_on_startup
    on_shutdown = media_on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end
    on_job_rejected = on_job_rejected
    on_health_check = on_health_check
    valkey_settings = ValkeyConfig.from_env().to_arq_valkey_settings()
    max_jobs = max(1, int(os.getenv("MEDIA_WORKER_MAX_JOBS", "2")))
    job_timeout = int(os.getenv("MEDIA_WORKER_JOB_TIMEOUT", "300"))
    keep_result = 0
    poll_delay = float(os.getenv("MEDIA_WORKER_POLL_DELAY", "0.5"))
    max_tries = int(os.getenv("WORKER_MAX_TRIES", "3"))
    health_check_interval = int(os.getenv("WORKER_HEALTH_CHECK_INTERVAL", "30"))
