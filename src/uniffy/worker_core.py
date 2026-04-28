"""Core worker entry point.

Run with ``python -m uniffy.worker_core`` or ``./run.sh worker-core``.
Owns the ``uniffy:queue:core`` queue: thumbnails, extraction, content
extraction, notifications, reminders, storage recalculation, task
reminders, chat mute. Tight SLA, local I/O.
"""

import os

from dotenv import load_dotenv

load_dotenv()

from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

bootstrap_multiproc_metrics("worker-core")

from uniffy.workers.runner import run_worker_with_restart
from uniffy.workers.settings import CoreWorkerSettings


def main() -> None:
    """Run the core ARQ worker with automatic restart on connection loss."""
    port = int(os.getenv("CORE_WORKER_METRICS_PORT", os.getenv("WORKER_METRICS_PORT", "9091")))
    run_worker_with_restart(
        CoreWorkerSettings,
        app_name="uniffy-worker-core",
        metrics_port=port,
    )


if __name__ == "__main__":
    main()
