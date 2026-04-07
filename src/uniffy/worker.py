"""
Background worker entry point.

Run with: python -m uniffy.worker
Or via: ./run.sh worker

The worker auto-restarts on transient Valkey connection failures with
exponential backoff (1s, 2s, 4s, ... capped at 30s). Consecutive
successes reset the backoff.
"""

import asyncio
import os
import time

from dotenv import load_dotenv

load_dotenv()

from arq import run_worker
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError

from uniffy.observability import (
    ObservabilityConfig,
    setup_observability,
)
from uniffy.observability.metrics import start_worker_metrics_server
from uniffy.workers.settings import WorkerSettings

# Setup observability
setup_observability(
    config=ObservabilityConfig(
        app_name="uniffy-worker",
        app_version="0.1.0",
        environment=os.getenv("ENVIRONMENT", "development"),
        console_log_level=os.getenv("LOG_LEVEL", "info").upper(),
    )
)

_MAX_BACKOFF = 30.0
_STABLE_THRESHOLD = 60.0  # seconds running before resetting backoff


def main() -> None:
    """Run the ARQ worker with automatic restart on connection loss."""
    start_worker_metrics_server()

    backoff = 1.0
    while True:
        # Python 3.14 removed implicit event loop creation in get_event_loop().
        # arq's run_worker still calls get_event_loop() internally, so we
        # ensure a fresh loop exists before each attempt.
        asyncio.set_event_loop(asyncio.new_event_loop())

        started_at = time.monotonic()
        try:
            run_worker(WorkerSettings)
            # Clean exit (e.g. SIGTERM) - don't restart
            break
        except (RedisConnectionError, ConnectionError, OSError, RuntimeError) as exc:
            uptime = time.monotonic() - started_at
            logger.warning(
                "Worker lost Valkey connection, restarting in "
                "{delay:.1f}s (uptime was {uptime:.0f}s): {err}",
                delay=backoff,
                uptime=uptime,
                err=str(exc),
            )
            # Reset backoff if the worker was stable for a while
            if uptime >= _STABLE_THRESHOLD:
                backoff = 1.0
            time.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()
