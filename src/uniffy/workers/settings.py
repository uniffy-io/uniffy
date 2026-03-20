"""
ARQ Worker Settings.

Configures the background worker with all registered tasks,
startup/shutdown hooks, and Valkey connection settings.

Run with: arq uniffy.workers.settings.WorkerSettings
"""

import os

from dotenv import load_dotenv

# Load .env before any imports that read environment variables
load_dotenv()

from uniffy.core.valkey import ValkeyConfig
from uniffy.observability import ObservabilityConfig, setup_observability

# Setup observability for worker process
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
    check_calendar_reminders,
    check_task_due_dates,
    deliver_email_notification,
    deliver_push_notification,
    execute_agent_cron_tasks,
    execute_single_agent_cron_task,
    extract_audio_metadata,
    extract_document_content,
    extract_image_metadata,
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
    on_job_end,
    on_job_start,
    on_shutdown,
    on_startup,
    process_notification_event,
    send_email_digest,
)


class WorkerSettings:
    """
    ARQ Worker configuration.

    This class defines all settings for the ARQ background worker
    including task functions, lifecycle hooks, and queue configuration.

    Attributes
    ----------
    functions : list
        List of task functions available to the worker.
    on_startup : callable
        Called when worker starts (init DB, S3, etc.).
    on_shutdown : callable
        Called when worker stops (cleanup connections).
    on_job_start : callable
        Called before each job starts.
    on_job_end : callable
        Called after each job completes.
    redis_settings : RedisSettings
        Valkey/Redis connection settings.
    max_jobs : int
        Maximum concurrent jobs per worker.
    job_timeout : int
        Timeout in seconds for each job.
    keep_result : int
        How long to keep job results (seconds).
    max_tries : int
        Maximum retry attempts for failed jobs.

    """

    # All registered task functions
    functions = [
        # Thumbnail generation
        generate_image_thumbnail,
        generate_pdf_thumbnail,
        generate_video_thumbnail,
        # Metadata extraction
        extract_image_metadata,
        extract_audio_metadata,
        # Document content extraction
        extract_document_content,
        # Agent cron (on-demand trigger)
        execute_single_agent_cron_task,
        # Notifications
        process_notification_event,
        deliver_push_notification,
        deliver_email_notification,
        send_email_digest,
    ]

    # Cron jobs
    cron_jobs = [
        cron(check_calendar_reminders, minute=None),  # Every minute
        cron(execute_agent_cron_tasks, minute=None),  # Every minute
        cron(check_task_due_dates, minute=None),  # Every minute
    ]

    # Lifecycle hooks
    on_startup = on_startup
    on_shutdown = on_shutdown
    on_job_start = on_job_start
    on_job_end = on_job_end

    # Valkey/Redis connection (loaded from environment at module import)
    redis_settings = ValkeyConfig.from_env().to_redis_settings()

    # Queue configuration (uses default ARQ queue name)
    # All values configurable via environment variables
    max_jobs = int(os.getenv("WORKER_MAX_JOBS", "10"))
    job_timeout = int(os.getenv("WORKER_JOB_TIMEOUT", "300"))
    keep_result = int(os.getenv("WORKER_KEEP_RESULT", "3600"))
    poll_delay = float(os.getenv("WORKER_POLL_DELAY", "0.5"))
    max_tries = int(os.getenv("WORKER_MAX_TRIES", "3"))

    # Health check
    health_check_interval = int(os.getenv("WORKER_HEALTH_CHECK_INTERVAL", "30"))
