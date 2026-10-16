"""Per-tick readings of database connections, Valkey clients and the realtime edit buffer."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import valkey.asyncio as avalkey

from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    accounting_key,
    bucket_prefix,
    due_key,
)
from uniffy.scripts.realtime_qualification.report import distribution

# The driver's own connections carry this prefix and stay out of the application counts.
DRIVER_APPLICATION = "realtime-qualification"
# A checkpoint age above this for a sustained interval misses the save target.
SUSTAINED_AGE_SECONDS = 30.0
_BUFFER_REPLIES_PER_BUCKET = 3
_SCAN_COUNT = 1000
# Every sampler tick issues these Valkey commands besides the buffer pipeline.
SAMPLER_INFO_COMMANDS = 4
SAMPLER_COMMANDS = SAMPLER_INFO_COMMANDS + 1 + _BUFFER_REPLIES_PER_BUCKET * BUCKET_COUNT

_CONNECTIONS_QUERY = (
    "SELECT coalesce(state, 'unknown') AS state, coalesce(application_name, '') AS application,"
    " count(*) AS connections FROM pg_stat_activity"
    " WHERE usename = current_user AND backend_type = 'client backend'"
    " AND application_name NOT LIKE $1 GROUP BY 1, 2"
)


@dataclass(frozen=True)
class BufferReading:
    pending_bytes: int
    pending_records: int
    pending_documents: int
    oldest_pending_seconds: float


TIMELINE_COLUMNS = (
    "seconds",
    "postgres_connections",
    "valkey_clients",
    "pending_documents",
    "pending_records",
    "oldest_pending_seconds",
    "core_queue_depth",
)


@dataclass
class Samples:
    clients: list[int] = field(default_factory=list)
    used_memory: list[int] = field(default_factory=list)
    queue_depth: list[int] = field(default_factory=list)
    queue_age_ms: list[float] = field(default_factory=list)
    container_memory: dict[str, list[int]] = field(default_factory=dict)
    probe_ms: list[float] = field(default_factory=list)
    probe_errors: int = 0
    connections: list[int] = field(default_factory=list)
    connections_by_state: Counter[str] = field(default_factory=Counter)
    connections_by_application: Counter[str] = field(default_factory=Counter)
    buffer: list[BufferReading] = field(default_factory=list)
    # One row per tick, in TIMELINE_COLUMNS order.
    timeline: list[tuple[float, int, int, int, int, float, int]] = field(default_factory=list)

    def record_connections(self, rows: list[asyncpg.Record]) -> int:
        states: Counter[str] = Counter()
        applications: Counter[str] = Counter()
        for row in rows:
            states[row["state"]] += row["connections"]
            applications[row["application"]] += row["connections"]
        # Counter union keeps the larger count, so these hold the per-tick maximum.
        self.connections_by_state |= states
        self.connections_by_application |= applications
        total = sum(states.values())
        self.connections.append(total)
        return total


async def connection_rows(db: asyncpg.Connection) -> list[asyncpg.Record]:
    return await db.fetch(_CONNECTIONS_QUERY, f"{DRIVER_APPLICATION}%")


async def buffer_reading(cache: avalkey.Valkey) -> BufferReading:
    """Deployment-wide pending totals, read the way the platform buffer card reads them."""
    async with cache.pipeline(transaction=False) as pipe:
        pipe.time()
        for bucket in range(BUCKET_COUNT):
            pipe.hmget(accounting_key(bucket), ["bytes", "records"])
            pipe.zcard(due_key(bucket))
            pipe.zrange(due_key(bucket), 0, 0, withscores=True)
        (seconds, microseconds), *replies = await pipe.execute()
    now_ms = seconds * 1000 + microseconds // 1000
    pending_bytes = pending_records = pending_documents = 0
    firsts: list[float] = []
    for index in range(0, len(replies), _BUFFER_REPLIES_PER_BUCKET):
        (stored, records), documents, first = replies[index : index + _BUFFER_REPLIES_PER_BUCKET]
        pending_bytes += int(stored or 0)
        pending_records += int(records or 0)
        pending_documents += documents
        firsts.extend(score for _, score in first)
    oldest = min(firsts, default=None)
    # A due entry scores its first pending edit plus the due delay, or a later backoff.
    oldest_ms = 0 if oldest is None else max(0.0, now_ms - oldest + DUE_DELAY_MS)
    return BufferReading(pending_bytes, pending_records, pending_documents, oldest_ms / 1000)


async def buffer_key_census(cache: avalkey.Valkey) -> dict[str, int]:
    """Buffer keys by kind (stream, control, receipts and the per-bucket indexes)."""
    kinds: Counter[str] = Counter()
    # Every bucket prefix ends in its closing hash-tag brace; the kind follows it.
    pattern = f"{bucket_prefix(0).partition('{')[0]}*"
    async for key in cache.scan_iter(match=pattern, count=_SCAN_COUNT):
        text = key.decode() if isinstance(key, bytes) else key
        kind = text.partition("}:")[2].partition(":")[0]
        kinds[kind or "other"] += 1
    return dict(sorted(kinds.items()))


def longest_stretch_above(times: list[float], values: list[float], threshold: float) -> float:
    """Longest span of consecutive samples above ``threshold``, in the samples' time unit."""
    longest = 0.0
    started: float | None = None
    for at, value in zip(times, values, strict=True):
        if value > threshold:
            started = at if started is None else started
            longest = max(longest, at - started)
        else:
            started = None
    return round(longest, 1)


def connection_result(samples: Samples) -> dict[str, Any]:
    return {
        "samples": len(samples.connections),
        "total": _spread(samples.connections),
        "max_by_state": dict(samples.connections_by_state.most_common()),
        "max_by_application": dict(samples.connections_by_application.most_common()),
        # Each sample is one implicit transaction on the database the window counts.
        "sampler_transactions": len(samples.connections),
    }


def buffer_result(samples: Samples) -> dict[str, Any]:
    readings = samples.buffer
    times = [row[0] for row in samples.timeline]
    oldest = [reading.oldest_pending_seconds for reading in readings]
    return {
        "samples": len(readings),
        "pending_bytes_max": max((reading.pending_bytes for reading in readings), default=0),
        "pending_records_max": max((reading.pending_records for reading in readings), default=0),
        "pending_documents_max": max((reading.pending_documents for reading in readings), default=0),
        "oldest_pending_seconds": distribution(oldest),
        "longest_above_sustained_seconds": longest_stretch_above(
            times, oldest, SUSTAINED_AGE_SECONDS
        ),
    }


def _spread(values: list[int]) -> dict[str, float | int]:
    stats = distribution([float(value) for value in values])
    if not values:
        return stats
    return {"min": min(values), "p50": stats["p50"], "max": stats["max"]}


def connection_summary(connections: dict[str, Any]) -> dict[str, str]:
    total = connections["total"]
    return {
        "application connections min/p50/max": (
            f"{total.get('min', '-')} / {total.get('p50', '-')} / {total.get('max', '-')}"
        ),
        "application connections max by state": _pairs(connections["max_by_state"]),
        "application connections max by process": _pairs(connections["max_by_application"]),
    }


def buffer_summary(buffer: dict[str, Any], census: dict[str, int]) -> dict[str, Any]:
    oldest = buffer["oldest_pending_seconds"]
    return {
        "buffer pending documents / records max": (
            f"{buffer['pending_documents_max']} / {buffer['pending_records_max']}"
        ),
        "buffer oldest pending s p50/p95/max": (
            f"{oldest.get('p50', '-')} / {oldest.get('p95', '-')} / {oldest.get('max', '-')}"
        ),
        "buffer oldest pending longest stretch above 30 s": (
            buffer["longest_above_sustained_seconds"]
        ),
        "buffer keys at end": _pairs(census) or "none",
    }


def _pairs(counts: dict[str, int]) -> str:
    return ", ".join(f"{key}={value}" for key, value in counts.items())
