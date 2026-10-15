"""PostgreSQL, Valkey and container counters read around one scenario window."""

from __future__ import annotations

import asyncio
import contextlib
import os
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg
import valkey
import valkey.asyncio as avalkey

from uniffy.core.jobs.types import QueueName
from uniffy.scripts.realtime_qualification.report import distribution

TRACKED_TABLES = ["realtime_yjs_snapshots", "notes_notes"]
SAMPLE_SECONDS = 0.5
SAMPLER_COMMANDS = 4
ADVISORY_LOCK_CALL = "pg_advisory"
TOP_STATEMENTS = 20
TOP_QUERY_CHARS = 240
MIB = 1024 * 1024


@dataclass(frozen=True)
class Endpoint:
    host: str
    port: int

    @classmethod
    def parse(cls, value: str) -> Endpoint:
        host, _, port = value.rpartition(":")
        return cls(host, int(port))


@dataclass
class Samples:
    clients: list[int] = field(default_factory=list)
    used_memory: list[int] = field(default_factory=list)
    queue_depth: list[int] = field(default_factory=list)
    queue_age_ms: list[float] = field(default_factory=list)
    container_memory: dict[str, list[int]] = field(default_factory=dict)
    probe_ms: list[float] = field(default_factory=list)
    probe_errors: int = 0


class Probes:
    """Credentials come from the stack environment and never reach output."""

    def __init__(
        self,
        postgres: Endpoint,
        valkey_endpoint: Endpoint,
        cgroups: dict[str, Path],
        *,
        probe_hz: float,
        checkpoint: bool,
        run_id: str,
    ) -> None:
        self.postgres = postgres
        self.valkey_endpoint = valkey_endpoint
        self.cgroups = cgroups
        self.probe_hz = probe_hz
        self.checkpoint = checkpoint
        self.run_id = run_id
        self.database: asyncpg.Connection | None = None
        self.cache: avalkey.Valkey | None = None
        self.statements_available = False

    def valkey_options(self) -> dict[str, Any]:
        return {
            "host": self.valkey_endpoint.host,
            "port": self.valkey_endpoint.port,
            "password": os.environ.get("VALKEY_PASSWORD") or None,
            "db": int(os.environ.get("VALKEY_DATABASE", "0")),
        }

    async def connect(self) -> dict[str, Any]:
        self.database = await asyncpg.connect(
            host=self.postgres.host,
            port=self.postgres.port,
            user=os.environ.get("POSTGRES_USER", "uniffy"),
            password=os.environ.get("POSTGRES_PASSWORD"),
            database=os.environ.get("POSTGRES_DB", "uniffy"),
            server_settings={"application_name": "realtime-qualification"},
        )
        try:
            await self.database.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
            # Keeps the probe's own queries out of the application statement counts.
            await self.database.execute("SET pg_stat_statements.track = 'none'")
            self.statements_available = True
        except asyncpg.PostgresError:
            self.statements_available = False
        self.cache = avalkey.Valkey(**self.valkey_options())
        server = await self.cache.info("server")
        persistence = await self.cache.info("persistence")
        policy = await self.cache.config_get("maxmemory-policy")
        return {
            "postgres_version": await self.database.fetchval("SHOW server_version"),
            "valkey_version": server.get("valkey_version") or server.get("redis_version"),
            "valkey_aof_enabled": persistence.get("aof_enabled"),
            "valkey_maxmemory_policy": policy.get("maxmemory-policy"),
            "pg_stat_statements": self.statements_available,
            "checkpoint_around_window": self.checkpoint,
        }

    async def close(self) -> None:
        if self.database is not None:
            await self.database.close()
        if self.cache is not None:
            await self.cache.aclose()

    async def postgres_counters(self, doc_ids: list[UUID]) -> dict[str, Any]:
        db = self.database
        if db is None:
            raise RuntimeError("probes are not connected")
        database = await db.fetchrow(
            "SELECT xact_commit, xact_rollback, blks_read, blks_hit, tup_returned,"
            " tup_fetched, tup_inserted, tup_updated, tup_deleted"
            " FROM pg_stat_database WHERE datname = current_database()"
        )
        wal = await db.fetchrow("SELECT wal_records, wal_fpi, wal_bytes FROM pg_stat_wal")
        io = await db.fetchrow(
            "SELECT coalesce(sum(writes), 0) AS blocks_written,"
            " coalesce(sum(extends), 0) AS blocks_extended, coalesce(sum(fsyncs), 0) AS fsyncs"
            " FROM pg_stat_io WHERE object = 'relation'"
        )
        tables = await db.fetch(
            "SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del,"
            " coalesce(seq_scan, 0) AS seq_scan, coalesce(idx_scan, 0) AS idx_scan"
            " FROM pg_stat_user_tables WHERE relname = ANY($1::text[])",
            TRACKED_TABLES,
        )
        maintenance = await db.fetchrow(
            "SELECT coalesce(sum(autovacuum_count), 0) AS autovacuum_runs,"
            " coalesce(sum(autoanalyze_count), 0) AS autoanalyze_runs FROM pg_stat_user_tables"
        )
        snapshots = await db.fetchrow(
            "SELECT count(*) AS rows, coalesce(sum(revision), 0) AS revisions,"
            " coalesce(sum(rendered_revision), 0) AS rendered_revisions,"
            " coalesce(sum(octet_length(updates)), 0) AS blob_bytes,"
            " coalesce(max(octet_length(updates)), 0) AS largest_blob_bytes"
            " FROM realtime_yjs_snapshots WHERE content_id = ANY($1::uuid[])",
            doc_ids,
        )
        return {
            "lsn": await db.fetchval("SELECT pg_current_wal_lsn()::text"),
            "database": dict(database or {}),
            "wal": {key: int(value) for key, value in dict(wal or {}).items()},
            "io": {key: int(value) for key, value in dict(io or {}).items()},
            # Column 0 is the table name; the rest are its counters.
            "tables": {row[0]: dict(list(row.items())[1:]) for row in tables},
            "snapshots": {key: int(value) for key, value in dict(snapshots or {}).items()},
            "maintenance": {key: int(value) for key, value in dict(maintenance or {}).items()},
        }

    async def statement_counts(self) -> dict[str, Any]:
        if not self.statements_available or self.database is None:
            return {}
        rows = await self.database.fetch(
            "SELECT query, calls, total_exec_time FROM pg_stat_statements"
            " WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())"
            " ORDER BY calls DESC"
        )
        calls: Counter[str] = Counter()
        exec_ms: Counter[str] = Counter()
        for row in rows:
            kind = _statement_kind(row["query"])
            calls[kind] += row["calls"]
            exec_ms[kind] += row["total_exec_time"]
        return {
            "calls": dict(calls.most_common()),
            "exec_ms": {kind: round(value, 1) for kind, value in exec_ms.most_common()},
            # Normalized text carries placeholders, never parameter values.
            "top": [
                {
                    "calls": row["calls"],
                    "exec_ms": round(row["total_exec_time"], 1),
                    "query": " ".join(row["query"].split())[:TOP_QUERY_CHARS],
                }
                for row in rows[:TOP_STATEMENTS]
            ],
        }

    def cpu_readings(self) -> dict[str, dict[str, int]]:
        readings: dict[str, dict[str, int]] = {}
        for name, path in self.cgroups.items():
            try:
                stat = dict(line.split() for line in (path / "cpu.stat").read_text().splitlines())
                readings[name] = {
                    "usage_usec": int(stat["usage_usec"]),
                    "memory": int((path / "memory.current").read_text()),
                }
            except OSError, KeyError, ValueError:
                continue
        return readings

    async def begin(self, doc_ids: list[UUID]) -> WindowProbe:
        if self.database is None or self.cache is None:
            raise RuntimeError("probes are not connected")
        if self.checkpoint:
            await self.database.execute("CHECKPOINT")
        if self.statements_available:
            await self.database.execute("SELECT pg_stat_statements_reset()")
        await self.cache.config_resetstat()
        window = WindowProbe(self, doc_ids)
        window.postgres = await self.postgres_counters(doc_ids)
        window.aof_bytes = int((await self.cache.info("persistence")).get("aof_current_size", 0))
        window.memory = int((await self.cache.info("memory"))["used_memory"])
        window.cpu = self.cpu_readings()
        window.started = time.perf_counter()
        window.start_sampling()
        return window


def _statement_kind(query: str) -> str:
    if ADVISORY_LOCK_CALL in query:
        return "advisory_lock"
    words = query.split(None, 1)
    return words[0].lower() if words else "empty"


class WindowProbe:
    """Counters at the window start plus samplers that run until ``finish``."""

    def __init__(self, probes: Probes, doc_ids: list[UUID]) -> None:
        self.probes = probes
        self.doc_ids = doc_ids
        self.samples = Samples()
        self.postgres: dict[str, Any] = {}
        self.aof_bytes = 0
        self.memory = 0
        self.cpu: dict[str, dict[str, int]] = {}
        self.started = 0.0
        self.sampler: asyncio.Task[None] | None = None
        self.stop_probe = threading.Event()
        self.probe_thread: threading.Thread | None = None

    def start_sampling(self) -> None:
        self.sampler = asyncio.create_task(self._sample())
        if self.probes.probe_hz > 0:
            self.probe_thread = threading.Thread(target=self._competing_workload, daemon=True)
            self.probe_thread.start()

    async def _sample(self) -> None:
        cache = self.probes.cache
        if cache is None:
            return
        queue = QueueName.CORE.valkey_name
        while True:
            clients = await cache.info("clients")
            memory = await cache.info("memory")
            self.samples.clients.append(int(clients["connected_clients"]))
            self.samples.used_memory.append(int(memory["used_memory"]))
            self.samples.queue_depth.append(int(await cache.zcard(queue)))
            oldest = await cache.zrange(queue, 0, 0, withscores=True)
            if oldest:
                # ARQ scores a queued job by the epoch millisecond it becomes runnable.
                self.samples.queue_age_ms.append(max(0.0, time.time() * 1000 - oldest[0][1]))
            for name, reading in self.probes.cpu_readings().items():
                self.samples.container_memory.setdefault(name, []).append(reading["memory"])
            await asyncio.sleep(SAMPLE_SECONDS)

    def _competing_workload(self) -> None:
        # A separate thread keeps the driver's event loop lag out of these timings.
        client = valkey.Valkey(**self.probes.valkey_options(), socket_timeout=2)
        interval = 1 / self.probes.probe_hz
        keys = [f"qualification:probe:{self.probes.run_id}:{index}" for index in range(32)]
        payload = b"x" * 256
        sequence = 0
        try:
            while not self.stop_probe.wait(interval):
                key = keys[sequence % len(keys)]
                sequence += 1
                try:
                    started = time.perf_counter()
                    client.set(key, payload, ex=600)
                    middle = time.perf_counter()
                    client.get(key)
                    finished = time.perf_counter()
                except valkey.ValkeyError:
                    self.samples.probe_errors += 1
                    continue
                self.samples.probe_ms += [(middle - started) * 1000, (finished - middle) * 1000]
        finally:
            with contextlib.suppress(valkey.ValkeyError):
                client.delete(*keys)
            client.close()

    async def finish(self) -> tuple[float, dict[str, Any], dict[str, Any], dict[str, Any]]:
        probes = self.probes
        if probes.database is None or probes.cache is None:
            raise RuntimeError("probes are not connected")
        self.stop_probe.set()
        if self.probe_thread is not None:
            await asyncio.to_thread(self.probe_thread.join)
        if self.sampler is not None:
            self.sampler.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.sampler
        if probes.checkpoint:
            await probes.database.execute("CHECKPOINT")
        window = time.perf_counter() - self.started
        cpu = probes.cpu_readings()
        after = await probes.postgres_counters(self.doc_ids)
        postgres = await self._postgres_result(after)
        valkey_result = await self._valkey_result()
        containers = {}
        for name, end in cpu.items():
            start = self.cpu.get(name)
            if start is None:
                continue
            seconds = (end["usage_usec"] - start["usage_usec"]) / 1_000_000
            peak = max(self.samples.container_memory.get(name, [end["memory"]]))
            containers[name] = {
                "cpu_seconds": round(seconds, 2),
                "average_cores": round(seconds / window, 3),
                "memory_peak_mib": round(peak / MIB, 1),
            }
        return window, postgres, valkey_result, containers

    async def _postgres_result(self, after: dict[str, Any]) -> dict[str, Any]:
        db = self.probes.database
        if db is None:
            raise RuntimeError("probes are not connected")
        before = self.postgres
        wal_bytes = await db.fetchval(
            "SELECT pg_wal_lsn_diff($1::text::pg_lsn, $2::text::pg_lsn)", after["lsn"], before["lsn"]
        )

        def delta(section: str) -> dict[str, int]:
            return {k: int(v) - int(before[section].get(k, 0)) for k, v in after[section].items()}

        tables = {
            name: {k: int(v) - int(before["tables"].get(name, {}).get(k, 0)) for k, v in row.items()}
            for name, row in after["tables"].items()
        }
        snapshots = delta("snapshots")
        statements = await self.probes.statement_counts()
        database = delta("database")
        wal = delta("wal")
        io = delta("io")
        maintenance = delta("maintenance")
        summary = {
            "wal_bytes (pg_current_wal_lsn delta)": int(wal_bytes),
            "wal_records": wal.get("wal_records"),
            "wal_full_page_images": wal.get("wal_fpi"),
            "blocks_written (pg_stat_io relation writes)": io.get("blocks_written"),
            "blocks_read (pg_stat_database)": database.get("blks_read"),
            "transactions committed": database.get("xact_commit"),
            "snapshot row revisions": snapshots.get("revisions"),
            "snapshot rendered revisions": snapshots.get("rendered_revisions"),
            "snapshot blob bytes at end": after["snapshots"].get("blob_bytes"),
            "snapshot row updates": tables.get("realtime_yjs_snapshots", {}).get("n_tup_upd"),
            "note row updates": tables.get("notes_notes", {}).get("n_tup_upd"),
            "autovacuum / autoanalyze runs": (
                f"{maintenance.get('autovacuum_runs')} / {maintenance.get('autoanalyze_runs')}"
            ),
            "statements executed": sum(statements.get("calls", {}).values()) or None,
        }
        return {
            "summary": summary,
            "wal_lsn_bytes": int(wal_bytes),
            "pg_stat_database": database,
            "pg_stat_wal": wal,
            "pg_stat_io_relation": io,
            "maintenance": maintenance,
            "tables": tables,
            "snapshot_rows": {"delta": snapshots, "end": after["snapshots"]},
            "statements": statements,
        }

    async def _valkey_result(self) -> dict[str, Any]:
        cache = self.probes.cache
        if cache is None:
            raise RuntimeError("probes are not connected")
        stats = await cache.info("stats")
        commands = await cache.info("commandstats")
        latency = await cache.info("latencystats")
        memory = int((await cache.info("memory"))["used_memory"])
        aof = int((await cache.info("persistence")).get("aof_current_size", 0))
        top = sorted(commands.items(), key=lambda item: -int(item[1].get("calls", 0)))[:12]
        command_calls = {name.removeprefix("cmdstat_"): int(v["calls"]) for name, v in top}
        percentiles = {
            name.removeprefix("latency_percentiles_usec_"): value
            for name, value in latency.items()
            if name.removeprefix("latency_percentiles_usec_") in command_calls
        }
        samples = self.samples
        probe = distribution(samples.probe_ms)
        processed = int(stats.get("total_commands_processed", 0))
        # Each probe sample is one command; each sampler tick issues four.
        driver_commands = len(samples.probe_ms) + SAMPLER_COMMANDS * len(samples.clients)
        summary = {
            "commands processed (driver share)": f"{processed} ({driver_commands})",
            "used_memory MiB start/end/max": (
                f"{self.memory / MIB:.1f} / {memory / MIB:.1f} / "
                f"{max(samples.used_memory or [memory]) / MIB:.1f}"
            ),
            "connected_clients max": max(samples.clients or [0]),
            "aof growth bytes": aof - self.aof_bytes,
            "core queue depth max": max(samples.queue_depth or [0]),
            "core queue oldest job age ms max": round(max(samples.queue_age_ms or [0.0]), 1),
            "competing probe p50/p95/p99 ms": (
                f"{probe.get('p50', '-')} / {probe.get('p95', '-')} / {probe.get('p99', '-')}"
            ),
        }
        return {
            "summary": summary,
            "probe_ms": probe,
            "probe_errors": samples.probe_errors,
            "commands_processed": processed,
            "driver_commands": driver_commands,
            "net_input_bytes": int(stats.get("total_net_input_bytes", 0)),
            "net_output_bytes": int(stats.get("total_net_output_bytes", 0)),
            "command_calls": command_calls,
            "command_latency_usec": percentiles,
            "used_memory_bytes": {
                "start": self.memory,
                "end": memory,
                "samples_max": max(samples.used_memory or [memory]),
            },
            "connected_clients": {
                "min": min(samples.clients or [0]),
                "max": max(samples.clients or [0]),
            },
            "aof_growth_bytes": aof - self.aof_bytes,
            "core_queue": {
                "depth_max": max(samples.queue_depth or [0]),
                "oldest_age_ms": distribution(samples.queue_age_ms),
                "samples": len(samples.queue_depth),
            },
        }
