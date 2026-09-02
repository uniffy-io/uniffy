"""ARQ worker runner with exponential-backoff restart on Valkey connection loss."""

import asyncio
import os
import time

from loguru import logger
from valkey.exceptions import ConnectionError as ValkeyConnectionError

from uniffy.core.jobs import QueueName
from uniffy.infrastructure.observability.config import LoggingConfig
from uniffy.infrastructure.observability.logger import configure_logging
from uniffy.infrastructure.observability.prometheus import start_worker_metrics_server
from uniffy.vendor.arq import run_worker
from uniffy.workers.metrics import (
    WORKER_READY,
    WORKER_RESTARTS_TOTAL,
    WorkerRestartReason,
)

logger = logger.bind(component="runner")

_MAX_BACKOFF = 30.0
_STABLE_THRESHOLD = 60.0


def _restart_reason(exc: BaseException) -> WorkerRestartReason:
    if isinstance(exc, ValkeyConnectionError):
        return WorkerRestartReason.VALKEY_CONNECTION
    if isinstance(exc, ConnectionError):
        return WorkerRestartReason.CONNECTION
    if isinstance(exc, OSError):
        return WorkerRestartReason.OS_ERROR
    return WorkerRestartReason.RUNTIME_ERROR


def run_worker_with_restart(
    settings_cls: type,
    *,
    app_name: str,
    metrics_port: int,
    queue: QueueName,
) -> None:
    """Run an ARQ worker class with a connection-loss restart loop."""
    configure_logging(
        config=LoggingConfig(
            app_name=app_name,
            app_version="0.1.0",
            console_log_level=os.getenv("LOG_LEVEL", "info").upper(),
            console_log_type=os.getenv("LOG_FORMAT", "console").lower(),
        )
    )
    start_worker_metrics_server(metrics_port)
    WORKER_READY.labels(queue=queue).set(0)

    backoff = 1.0
    while True:
        asyncio.set_event_loop(asyncio.new_event_loop())

        started_at = time.monotonic()
        try:
            run_worker(settings_cls)
            break
        except (ValkeyConnectionError, ConnectionError, OSError, RuntimeError) as exc:
            uptime = time.monotonic() - started_at
            WORKER_READY.labels(queue=queue).set(0)
            WORKER_RESTARTS_TOTAL.labels(queue=queue, reason=_restart_reason(exc)).inc()
            logger.warning(
                "Worker lost Valkey connection, restarting in "
                "{delay:.1f}s (uptime was {uptime:.0f}s, app={app}): {err}",
                delay=backoff,
                uptime=uptime,
                app=app_name,
                err=str(exc),
            )
            if uptime >= _STABLE_THRESHOLD:
                backoff = 1.0
            time.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)
        except KeyboardInterrupt:
            break
