"""Summaries and evidence files for one qualification run."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from uniffy.core.json_codec import OPTION_INDENT_2, dumps_bytes


def distribution(samples: list[float]) -> dict[str, float | int]:
    """Nearest-rank percentiles, so every reported value is an observed sample."""
    if not samples:
        return {"count": 0}
    ordered = sorted(samples)

    def rank(fraction: float) -> float:
        return round(ordered[max(0, math.ceil(fraction * len(ordered)) - 1)], 3)

    return {
        "count": len(ordered),
        "p50": rank(0.50),
        "p95": rank(0.95),
        "p99": rank(0.99),
        "max": round(ordered[-1], 3),
    }


def write_evidence(output_dir: Path, run: dict[str, Any]) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    json_path = output_dir / f"baseline-{stamp}.json"
    markdown_path = output_dir / f"baseline-{stamp}.md"
    json_path.write_bytes(dumps_bytes(run, option=OPTION_INDENT_2))
    markdown_path.write_text(_markdown(run, json_path.name))
    return json_path, markdown_path


def _cell(stats: dict[str, Any], key: str) -> str:
    value = stats.get(key)
    return "-" if value is None else f"{value}"


def _latency_row(label: str, stats: dict[str, Any]) -> str:
    return (
        f"| {label} | {stats.get('count', 0)} | {_cell(stats, 'p50')} | {_cell(stats, 'p95')} "
        f"| {_cell(stats, 'p99')} | {_cell(stats, 'max')} |"
    )


def _scenario_markdown(scenario: dict[str, Any]) -> list[str]:
    workload = scenario["workload"]
    edits = scenario["edits"]
    received = scenario["received"]
    latency = scenario["latency_ms"]
    postgres = scenario["postgres"]
    valkey = scenario["valkey"]
    lines = [
        f"## {scenario['name']}",
        "",
        f"Workload: {workload['documents']} documents, {workload['writers_per_document']} writers "
        f"per document, edit interval {workload['edit_interval_ms']} ms, "
        f"{workload['edit_chars']} chars per edit, client batch {workload['batch_ms']} ms, "
        f"{workload['sockets']} sockets, edit phase {workload['edit_seconds']} s, "
        f"measured window {scenario['window_seconds']} s.",
        "",
        f"Edits made {edits['made']}, update frames sent {edits['frames']}, at end unaccepted "
        f"{edits['unaccepted']}, uncheckpointed {edits['uncheckpointed']}, peer deliveries "
        f"missing {edits['unseen']}, converged {edits['converged']}.",
        "",
        f"Frames received: accepted receipts (11) {received['accepted_receipt']}, checkpoint "
        f"progress (12) {received['checkpoint_progress']}, session state (13) "
        f"{received['session_state']}, committed (7) {received['committed']}.",
        "",
        "| Latency (ms) | count | p50 | p95 | p99 | max |",
        "| --- | --- | --- | --- | --- | --- |",
        _latency_row("acceptance, send to receipt", latency["acceptance"]),
        _latency_row("edit to receipt", latency["edit_to_acceptance"]),
        _latency_row("checkpoint age, edit to checkpoint", latency["checkpoint_age"]),
        _latency_row("peer visibility from edit", latency["visibility_from_edit"]),
        _latency_row("peer visibility from send", latency["visibility_from_send"]),
        _latency_row("valkey competing probe", valkey.get("probe_ms", {})),
        _latency_row("driver event loop lag", scenario["driver"]["loop_lag_ms"]),
        "",
        "| PostgreSQL | value |",
        "| --- | --- |",
    ]
    for key, value in postgres.get("summary", {}).items():
        lines.append(f"| {key} | {value} |")
    calls = postgres.get("statements", {}).get("calls", {})
    if calls:
        lines += ["", "Statements by kind: " + ", ".join(f"{k}={v}" for k, v in calls.items())]
    lines += ["", "| Valkey | value |", "| --- | --- |"]
    for key, value in valkey.get("summary", {}).items():
        lines.append(f"| {key} | {value} |")
    lines += ["", "| Container CPU | cpu seconds | average cores | memory peak MiB |"]
    lines.append("| --- | --- | --- | --- |")
    for name, cpu in scenario["cpu"].items():
        lines.append(
            f"| {name} | {cpu.get('cpu_seconds', '-')} | {cpu.get('average_cores', '-')} "
            f"| {cpu.get('memory_peak_mib', '-')} |"
        )
    if scenario["errors"]:
        lines += ["", "Errors: " + ", ".join(f"{k}={v}" for k, v in scenario["errors"].items())]
    return [*lines, ""]


def _markdown(run: dict[str, Any], json_name: str) -> str:
    lines = [
        "# Realtime qualification baseline",
        "",
        f"Started {run['started_at']}, finished {run['finished_at']}. Raw data: `{json_name}`.",
        "",
        "Parameters: "
        + ", ".join(f"{key}={value}" for key, value in run["parameters"].items())
        + ".",
        "",
        "Labels: " + (", ".join(f"{k}={v}" for k, v in run["labels"].items()) or "none") + ".",
        "",
        "Environment: "
        + ", ".join(f"{key}={value}" for key, value in run["environment"].items())
        + ".",
        "",
    ]
    for scenario in run["scenarios"]:
        lines += _scenario_markdown(scenario)
    return "\n".join(lines)
