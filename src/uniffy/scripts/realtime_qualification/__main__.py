"""Measure the current realtime path on the disposable qualification stack."""

from __future__ import annotations

import argparse
import asyncio
import os
import platform
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pycrdt
from loguru import logger

from uniffy.scripts.realtime_qualification.probes import Endpoint, Probes
from uniffy.scripts.realtime_qualification.report import write_evidence
from uniffy.scripts.realtime_qualification.scenarios import (
    Awareness,
    Scenario,
    Settings,
    run_scenario,
)
from uniffy.scripts.realtime_qualification.stack import login, roster_emails

DEFAULT_OUTPUT = Path("/app/.agents/local/reviews/evidence/realtime-stream-checkpointing/baseline")
# The heaviest scenario runs last so its vacuum and projection aftermath lands in no other window.
SCENARIO_NAMES = ("idle", "hot-doc", "many-docs")


def _pairs(values: list[str], flag: str) -> dict[str, str]:
    pairs = {}
    for value in values:
        key, separator, item = value.partition("=")
        if not separator or not key:
            raise SystemExit(f"{flag} expects KEY=VALUE, got {value!r}")
        pairs[key] = item
    return pairs


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m uniffy.scripts.realtime_qualification",
        description="Drive real multiplexed realtime sockets against the qualification stack "
        "and record latency, PostgreSQL, Valkey and container cost per scenario.",
    )
    parser.add_argument(
        "--scenario", action="append", choices=SCENARIO_NAMES, help="Repeatable; default all"
    )
    parser.add_argument(
        "--backend",
        action="append",
        help="Backend base URL, repeatable; sockets alternate across them "
        "(default http://backend-a:8000 and http://backend-b:8000)",
    )
    parser.add_argument("--postgres", default="postgres:5432", help="HOST:PORT")
    parser.add_argument("--valkey", default="valkey:6379", help="HOST:PORT")
    parser.add_argument("--users", type=int, default=10, help="Seeded logins to spread sockets over")
    parser.add_argument("--duration", type=float, default=60, help="Edit phase seconds")
    parser.add_argument("--hot-writers", type=int, default=3)
    parser.add_argument("--hot-interval-ms", type=float, default=50)
    parser.add_argument("--many-documents", type=int, default=100)
    parser.add_argument("--many-interval-ms", type=float, default=250)
    parser.add_argument("--idle-documents", type=int, default=100)
    parser.add_argument("--edit-chars", type=int, default=1, help="Characters typed per edit")
    parser.add_argument("--doc-bytes", type=int, default=4096, help="Initial document size")
    parser.add_argument(
        "--batch-ms",
        type=float,
        default=50,
        help="Client transport batch window, as the web client",
    )
    parser.add_argument(
        "--awareness",
        type=Awareness,
        choices=list(Awareness),
        default=Awareness.EDITS,
        help="edits sends a cursor update per edit plus keepalives, as the web editor",
    )
    parser.add_argument("--awareness-seconds", type=float, default=15)
    parser.add_argument("--resync-seconds", type=float, default=30)
    parser.add_argument("--docs-per-socket", type=int, default=25, help="Observer multiplexing")
    parser.add_argument(
        "--settle",
        type=float,
        default=15,
        help="Seconds measured after drain, so the last projections land in the same window",
    )
    parser.add_argument(
        "--drain-timeout",
        type=float,
        default=120,
        help="Seconds to wait for receipts, checkpoints and peer deliveries after the edit phase",
    )
    parser.add_argument("--valkey-probe-hz", type=float, default=20, help="0 disables")
    parser.add_argument(
        "--no-checkpoint",
        action="store_true",
        help="Skip the PostgreSQL CHECKPOINT that bounds each window's block writes",
    )
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--cgroup", action="append", default=[], metavar="NAME=PATH", help="Container cgroup dir"
    )
    parser.add_argument("--label", action="append", default=[], metavar="KEY=VALUE")
    return parser.parse_args()


def _scenarios(args: argparse.Namespace) -> list[Scenario]:
    catalog = {
        "hot-doc": Scenario("hot-doc", 1, args.hot_writers, args.hot_interval_ms / 1000, False),
        "many-docs": Scenario(
            "many-docs", args.many_documents, 1, args.many_interval_ms / 1000, True
        ),
        "idle": Scenario("idle", args.idle_documents, 1, 0, False),
    }
    return [catalog[name] for name in args.scenario or SCENARIO_NAMES]


async def _run(args: argparse.Namespace) -> None:
    password = os.environ.get("QUAL_USER_PASSWORD")
    if not password:
        raise SystemExit("QUAL_USER_PASSWORD is not set; run inside the qualification stack")
    backends = [url.rstrip("/") for url in args.backend or []] or [
        "http://backend-a:8000",
        "http://backend-b:8000",
    ]
    settings = Settings(
        backends=backends,
        duration=args.duration,
        batch_seconds=args.batch_ms / 1000,
        edit_chars=args.edit_chars,
        doc_bytes=args.doc_bytes,
        awareness=args.awareness,
        awareness_seconds=args.awareness_seconds,
        resync_seconds=args.resync_seconds,
        docs_per_socket=args.docs_per_socket,
        settle=args.settle,
        drain_timeout=args.drain_timeout,
        seed=args.seed,
    )
    cgroups = {name: Path(path) for name, path in _pairs(args.cgroup, "--cgroup").items()}
    run_id = uuid.uuid4().hex[:12]
    probes = Probes(
        Endpoint.parse(args.postgres),
        Endpoint.parse(args.valkey),
        cgroups,
        probe_hz=args.valkey_probe_hz,
        checkpoint=not args.no_checkpoint,
        run_id=run_id,
    )
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    environment = await probes.connect()
    api_url = f"{backends[0]}/api"
    identities = await login(api_url, roster_emails(args.users), password)
    scenarios: list[dict[str, Any]] = []
    try:
        for scenario in _scenarios(args):
            logger.info(f"running scenario {scenario.name}")
            scenarios.append(await run_scenario(scenario, settings, identities, probes, api_url))
    finally:
        await probes.close()
    parameters = {
        key: value
        for key, value in vars(args).items()
        if key not in {"cgroup", "label", "output_dir"}
    }
    parameters["backend"] = backends
    run = {
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "parameters": parameters,
        "labels": _pairs(args.label, "--label"),
        "environment": {
            **environment,
            "cgroups_measured": sorted(cgroups),
            "driver_python": platform.python_version(),
            "pycrdt": pycrdt.__version__,
            "host_cpus": os.cpu_count(),
        },
        "scenarios": scenarios,
    }
    json_path, markdown_path = write_evidence(args.output_dir, run)
    logger.info(f"wrote {json_path} and {markdown_path}")


def main() -> None:
    asyncio.run(_run(_parse_args()))


if __name__ == "__main__":
    main()
