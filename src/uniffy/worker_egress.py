"""Egress worker entry point.

Run with ``python -m uniffy.worker_egress`` or ``./run.sh
worker-egress``. Owns the ``uniffy:queue:egress`` queue: agent
runtime, agent compaction, agent cron, future external-API
integrations. I/O bound, retry-heavy, slow.
"""

import os

from dotenv import load_dotenv

load_dotenv()

from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

bootstrap_multiproc_metrics("worker-egress")

from uniffy.workers.runner import run_worker_with_restart
from uniffy.workers.settings import EgressWorkerSettings


def main() -> None:
    """Run the egress ARQ worker with automatic restart on connection loss."""
    port = int(os.getenv("EGRESS_WORKER_METRICS_PORT", "9092"))
    run_worker_with_restart(
        EgressWorkerSettings,
        app_name="uniffy-worker-egress",
        metrics_port=port,
    )


if __name__ == "__main__":
    main()
