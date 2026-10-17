"""Uniffy process entrypoint."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import sys
from collections.abc import Sequence
from typing import TYPE_CHECKING, TextIO

from dotenv import load_dotenv
from loguru import logger

from uniffy.cli import MFA_RESET_FLAG

if TYPE_CHECKING:
    from uniffy.core.realtime.buffer import UpdateBuffer


def _run_backend() -> None:
    from uniffy.infrastructure.observability.bootstrap import bootstrap_multiproc_metrics

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
    from uniffy.infrastructure.observability.bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("worker-core")

    from uniffy.workers.fleets import CoreWorkerSettings
    from uniffy.workers.runner import run_worker_with_restart

    port = int(os.getenv("CORE_WORKER_METRICS_PORT", os.getenv("WORKER_METRICS_PORT", "9091")))
    run_worker_with_restart(
        CoreWorkerSettings,
        app_name="uniffy-worker-core",
        metrics_port=port,
        queue=CoreWorkerSettings.resource_profile.queue,
    )


def _run_worker_egress() -> None:
    from uniffy.infrastructure.observability.bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("worker-egress")

    from uniffy.workers.fleets import EgressWorkerSettings
    from uniffy.workers.runner import run_worker_with_restart

    port = int(os.getenv("EGRESS_WORKER_METRICS_PORT", "9092"))
    run_worker_with_restart(
        EgressWorkerSettings,
        app_name="uniffy-worker-egress",
        metrics_port=port,
        queue=EgressWorkerSettings.resource_profile.queue,
    )


def _run_worker_media() -> None:
    from uniffy.infrastructure.observability.bootstrap import bootstrap_multiproc_metrics

    bootstrap_multiproc_metrics("worker-media")

    from uniffy.workers.fleets import MediaWorkerSettings
    from uniffy.workers.runner import run_worker_with_restart

    run_worker_with_restart(
        MediaWorkerSettings,
        app_name="uniffy-worker-media",
        metrics_port=int(os.getenv("MEDIA_WORKER_METRICS_PORT", "9093")),
        queue=MediaWorkerSettings.resource_profile.queue,
    )


def install_realtime_adapters() -> None:
    """Locking a live document reads its domain policy, so every content adapter is registered."""
    from uniffy.core.search import SearchIndexer, WorkspaceSearch
    from uniffy.domains.notes.adapter import register_note_realtime_adapter
    from uniffy.domains.projects.realtime import register_task_realtime_adapter
    from uniffy.domains.scheduling.calendar.realtime import register_event_realtime_adapter
    from uniffy.infrastructure.search import MeiliSearchEngine

    # Checkpoints render nothing; projection jobs on the workers do, with their own indexer.
    search_indexer = SearchIndexer(WorkspaceSearch(MeiliSearchEngine()))
    register_note_realtime_adapter(search_indexer)
    register_task_realtime_adapter(search_indexer)
    register_event_realtime_adapter(search_indexer)


async def checkpoint_now(buffer: UpdateBuffer, out: TextIO) -> int:
    """Checkpoint every buffered stream; non-zero while Valkey still holds edits PostgreSQL lacks."""
    from uniffy.core.realtime.checkpoint import checkpoint_all_pending

    install_realtime_adapters()
    report = await checkpoint_all_pending(buffer)
    # Every other stream belonged to a replaced or deleted document and its keys are gone.
    retired = report.streams - report.checkpointed - len(report.unreadable)
    print(f"Buffered streams: {report.streams}", file=out)
    print(f"Checkpointed documents: {report.checkpointed} ({report.records} edits)", file=out)
    print(f"Retired streams of replaced or deleted documents: {retired}", file=out)
    print(f"Unreadable streams left in Valkey: {len(report.unreadable)}", file=out)
    for stream in report.unreadable:
        left = "unknown" if stream.records is None else stream.records
        print(f"  {stream.member} reason={stream.reason} records_left={left}", file=out)
    return 1 if report.unreadable else 0


async def _checkpoint_now_process() -> int:
    from uniffy.core.jobs import QueueName
    from uniffy.core.realtime.buffer import UpdateBuffer
    from uniffy.core.realtime.preflight import ensure_buffer_ready
    from uniffy.infrastructure.database import close_db, init_db
    from uniffy.infrastructure.valkey.binary import close_binary_client
    from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
    from uniffy.infrastructure.valkey.queue import close_queue, init_queue

    async with contextlib.AsyncExitStack() as resources:
        await init_db(skip_migrations=True, application_name="uniffy-realtime-checkpoint-now")
        resources.push_async_callback(close_db)
        await ensure_buffer_ready()
        resources.push_async_callback(close_binary_client)
        # Replicas learn the new watermark and projection follows, as after a worker checkpoint.
        await init_pubsub()
        resources.push_async_callback(close_pubsub)
        await init_queue(QueueName.CORE)
        resources.push_async_callback(close_queue, QueueName.CORE)
        return await checkpoint_now(UpdateBuffer(), sys.stdout)


def _run_realtime_checkpoint_now() -> None:
    # The report owns stdout. Without variable values in tracebacks, no connection URL is printed.
    logger.remove()
    logger.add(sys.stderr, level="WARNING", diagnose=False)
    sys.exit(asyncio.run(_checkpoint_now_process()))


_MODES = {
    "backend": _run_backend,
    "worker-core": _run_worker_core,
    "worker-egress": _run_worker_egress,
    "worker-media": _run_worker_media,
    "realtime-checkpoint-now": _run_realtime_checkpoint_now,
}


def parse_mode(argv: Sequence[str]) -> str:
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

    group.add_argument(
        "--worker-media",
        dest="mode",
        action="store_const",
        const="worker-media",
        help="Run the media ARQ worker (uniffy:queue:media).",
    )
    group.add_argument(
        "--realtime-checkpoint-now",
        dest="mode",
        action="store_const",
        const="realtime-checkpoint-now",
        help=(
            "Checkpoint every buffered realtime edit into PostgreSQL, then exit. Run it before "
            "wiping Valkey; a non-zero exit lists streams it could not read."
        ),
    )
    return parser.parse_args(argv).mode


def main() -> None:
    load_dotenv()

    if MFA_RESET_FLAG in sys.argv:
        from uniffy.cli.mfa import run as _run_mfa_reset

        _run_mfa_reset()
        return

    _MODES[parse_mode(sys.argv[1:])]()


if __name__ == "__main__":
    main()
