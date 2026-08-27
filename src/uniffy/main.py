"""Uniffy process entrypoint."""

import argparse
import os
import sys

from dotenv import load_dotenv

from uniffy.cli import MFA_RESET_FLAG


def _run_backend() -> None:
    from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("backend")

    from granian import Granian
    from granian.constants import HTTPModes, Interfaces, Loops
    from granian.http import HTTP2Settings
    from granian.log import LogLevels

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))

    server = Granian(
        target="uniffy.factory:create_app",
        address=host,
        port=port,
        interface=Interfaces.ASGI,
        workers=workers,
        http=HTTPModes.auto,
        http2_settings=HTTP2Settings(
            max_concurrent_streams=128,
            max_headers_size=65536,
            max_frame_size=16384,
        ),
        log_level=LogLevels.warning,
        log_access=False,
        factory=True,
        loop=Loops.auto,
    )

    server.serve()


def _run_worker_core() -> None:
    from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("worker-core")

    from uniffy.workers.runner import run_worker_with_restart
    from uniffy.workers.settings import CoreWorkerSettings

    port = int(os.getenv("CORE_WORKER_METRICS_PORT", os.getenv("WORKER_METRICS_PORT", "9091")))
    run_worker_with_restart(
        CoreWorkerSettings,
        app_name="uniffy-worker-core",
        metrics_port=port,
        queue=CoreWorkerSettings.resource_profile.queue,
    )


def _run_worker_egress() -> None:
    from uniffy._metrics_bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("worker-egress")

    from uniffy.workers.runner import run_worker_with_restart
    from uniffy.workers.settings import EgressWorkerSettings

    port = int(os.getenv("EGRESS_WORKER_METRICS_PORT", "9092"))
    run_worker_with_restart(
        EgressWorkerSettings,
        app_name="uniffy-worker-egress",
        metrics_port=port,
        queue=EgressWorkerSettings.resource_profile.queue,
    )


_MODES = {
    "backend": _run_backend,
    "worker-core": _run_worker_core,
    "worker-egress": _run_worker_egress,
}


def main() -> None:
    load_dotenv()

    if MFA_RESET_FLAG in sys.argv:
        from uniffy.cli.mfa import run as _run_mfa_reset

        _run_mfa_reset()
        return

    parser = argparse.ArgumentParser(
        prog="python -m uniffy",
        description="Uniffy process entrypoint - pick exactly one mode.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--backend",
        dest="mode",
        action="store_const",
        const="backend",
        help="Run the FastAPI/Granian backend.",
    )
    group.add_argument(
        "--worker-core",
        dest="mode",
        action="store_const",
        const="worker-core",
        help="Run the core ARQ worker (uniffy:queue:core).",
    )
    group.add_argument(
        "--worker-egress",
        dest="mode",
        action="store_const",
        const="worker-egress",
        help="Run the egress ARQ worker (uniffy:queue:egress).",
    )

    args = parser.parse_args()
    _MODES[args.mode]()


if __name__ == "__main__":
    main()
