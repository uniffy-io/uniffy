"""ARQ worker settings for the core and egress fleets.

Two worker classes, two queues, one Valkey instance. Run via:
    `arq uniffy.workers.settings.CoreWorkerSettings`
    `arq uniffy.workers.settings.EgressWorkerSettings`
"""

import os

from dotenv import load_dotenv

load_dotenv()

from uniffy.core.valkey import ValkeyConfig
from uniffy.observability import ObservabilityConfig, setup_observability

_environment = os.getenv("ENVIRONMENT", "development")
_log_level = os.getenv("LOG_LEVEL", "info").upper()

setup_observability(
    config=ObservabilityConfig(
        app_name="uniffy-worker",
        app_version="0.1.0",
        environment=_environment,
        console_log_level=_log_level,
    )
)
from arq.cron import cron

from uniffy.workers.tasks import (
    CORE_TASKS,
    EGRESS_TASKS,
    auto_unmute_channels,
    check_calendar_reminders,
    check_task_due_dates,
    core_on_shutdown,
    core_on_startup,
    egress_on_shutdown,
    egress_on_startup,
    execute_agent_cron_tasks,
    expire_support_sessions,
    flush_chat_read_cursors,
    notify_pending_org_purges,
    on_job_end,
    on_job_start,
    reap_expired_multipart_uploads,
    recalculate_all_storage_usage,
)

_redis_settings = ValkeyConfig.from_env().to_arq_redis_settings()
_core_job_timeout = int(os.getenv("WORKER_JOB_TIMEOUT", "300"))
_egress_job_timeout = int(os.getenv("EGRESS_WORKER_JOB_TIMEOUT", "900"))
_keep_result = int(os.getenv("WORKER_KEEP_RESULT", "3600"))
_max_tries = int(os.getenv("WORKER_MAX_TRIES", "3"))
_health_check_interval = int(os.getenv("WORKER_HEALTH_CHECK_INTERVAL", "30"))


class CoreWorkerSettings:
    """Core worker fleet: short jobs + cron schedules."""

    queue_name = "uniffy:queue:core"
    functions = list(CORE_TASKS)
    cron_jobs = [
        cron(check_calendar_reminders, minute=None),
        cron(check_task_due_dates, minute=None),
        cron(flush_chat_read_cursors, second={0, 30}),
        cron(auto_unmute_channels, minute=None, second={0}),
        cron(recalculate_all_storage_usage, hour=3, minute=0),
        cron(reap_expired_multipart_uploads, minute={0}),
        cron(notify_pending_org_purges, hour=2, minute=15),
        cron(expire_support_sessions, minute=None),
    ]
    on_startup = core_on_startup
    on_shutdown = core_on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end
    redis_settings = _redis_settings
    max_jobs = int(os.getenv("CORE_WORKER_MAX_JOBS", "10"))
    job_timeout = _core_job_timeout
    keep_result = _keep_result
    poll_delay = float(os.getenv("CORE_WORKER_POLL_DELAY", "0.5"))
    max_tries = _max_tries
    health_check_interval = _health_check_interval


class EgressWorkerSettings:
    """Egress worker fleet: outbound LLM + slow IO jobs."""

    queue_name = "uniffy:queue:egress"
    functions = list(EGRESS_TASKS)
    cron_jobs = [
        cron(execute_agent_cron_tasks, minute=None),
    ]
    on_startup = egress_on_startup
    on_shutdown = egress_on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end
    redis_settings = _redis_settings
    max_jobs = int(os.getenv("EGRESS_WORKER_MAX_JOBS", "50"))
    job_timeout = _egress_job_timeout
    keep_result = _keep_result
    poll_delay = float(os.getenv("EGRESS_WORKER_POLL_DELAY", "0.05"))
    max_tries = _max_tries
    health_check_interval = _health_check_interval
