"""ARQ worker runner with exponential-backoff restart on Valkey connection loss."""

import asyncio
import os
import time

from arq import run_worker
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError

from uniffy.observability import ObservabilityConfig, setup_observability
from uniffy.observability.metrics import start_worker_metrics_server

_MAX_BACKOFF = 30.0
_STABLE_THRESHOLD = 60.0


def run_worker_with_restart(
    settings_cls: type,
    *,
    app_name: str,
    metrics_port: int,
) -> None:
    """Run an ARQ worker class with a connection-loss restart loop."""
    setup_observability(
        config=ObservabilityConfig(
            app_name=app_name,
            app_version="0.1.0",
            environment=os.getenv("ENVIRONMENT", "development"),
            console_log_level=os.getenv("LOG_LEVEL", "info").upper(),
        )
    )
    start_worker_metrics_server(metrics_port)

    backoff = 1.0
    while True:
        asyncio.set_event_loop(asyncio.new_event_loop())

        started_at = time.monotonic()
        try:
            run_worker(settings_cls)
            break
        except (RedisConnectionError, ConnectionError, OSError, RuntimeError) as exc:
            uptime = time.monotonic() - started_at
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
