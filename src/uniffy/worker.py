"""
Background worker entry point.

Run with: python -m uniffy.worker
Or via: ./run.sh worker
"""

import os

from dotenv import load_dotenv

load_dotenv()

from arq import run_worker

from uniffy.observability import ObservabilityConfig, setup_observability
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


def main() -> None:
    """Run the ARQ worker."""
    run_worker(WorkerSettings)


if __name__ == "__main__":
    main()
