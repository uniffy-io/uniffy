"""Scenario layouts: which sockets attach which documents and how fast writers type."""

from __future__ import annotations

import asyncio
import itertools
import random
import time
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from uuid import UUID

from uniffy.core.realtime.state import doc_name_for
from uniffy.core.types import ContentType
from uniffy.scripts.realtime_qualification.client import (
    DocReplica,
    EditLog,
    RealtimeSocket,
    Recorder,
)
from uniffy.scripts.realtime_qualification.probes import Probes
from uniffy.scripts.realtime_qualification.report import distribution
from uniffy.scripts.realtime_qualification.stack import Identity, create_notes, document_text

OPEN_CONCURRENCY = 16
SYNC_TIMEOUT_SECONDS = 60
DRAIN_POLL_SECONDS = 0.1
LOOP_TICK_SECONDS = 0.05
TYPED_ALPHABET = "abcdefghijklmnopqrstuvwxyz     "
SOCKET_SCHEMES = {"http": "ws", "https": "wss"}


class Awareness(StrEnum):
    """How often a socket publishes cursor awareness, as the web editor does."""

    EDITS = "edits"
    KEEPALIVE = "keepalive"
    OFF = "off"


@dataclass(frozen=True)
class Scenario:
    name: str
    documents: int
    writers_per_document: int
    edit_interval: float
    # Read-only peers on the other replica measure cross-process visibility.
    observers: bool


@dataclass(frozen=True)
class Settings:
    backends: list[str]
    duration: float
    batch_seconds: float
    edit_chars: int
    doc_bytes: int
    awareness: Awareness
    awareness_seconds: float
    resync_seconds: float
    docs_per_socket: int
    settle: float
    drain_timeout: float
    seed: int


@dataclass
class Layout:
    sockets: list[tuple[RealtimeSocket, list[DocReplica]]]
    writers: list[DocReplica]
    replicas_by_doc: dict[str, list[DocReplica]]


def _socket_url(base: str, organization_id: str) -> str:
    scheme, _, rest = base.partition("://")
    return f"{SOCKET_SCHEMES[scheme]}://{rest}/api/realtime?org_id={organization_id}"


def _layout(
    scenario: Scenario,
    settings: Settings,
    doc_ids: list[UUID],
    identities: list[Identity],
    recorder: Recorder,
) -> Layout:
    backends = settings.backends
    client_ids = itertools.count(1001)
    users = itertools.cycle(identities)
    sockets: list[tuple[RealtimeSocket, list[DocReplica]]] = []
    writers: list[DocReplica] = []
    replicas_by_doc: dict[str, list[DocReplica]] = {}
    edit_logs: dict[str, dict[int, EditLog]] = {}
    observed: dict[int, list[str]] = {}

    def replica(name: str, *, writer: bool) -> DocReplica:
        item = DocReplica(
            name,
            next(client_ids),
            edit_logs.setdefault(name, {}),
            recorder,
            writer=writer,
            batch_seconds=settings.batch_seconds,
            awareness_per_edit=writer and settings.awareness is Awareness.EDITS,
        )
        replicas_by_doc.setdefault(name, []).append(item)
        return item

    socket_index = 0
    for doc_id in doc_ids:
        name = doc_name_for((ContentType.NOTE, doc_id))
        for _ in range(scenario.writers_per_document):
            backend = socket_index % len(backends)
            socket_index += 1
            identity = next(users)
            socket = RealtimeSocket(
                _socket_url(backends[backend], identity.organization_id), identity.token, recorder
            )
            item = replica(name, writer=True)
            sockets.append((socket, [item]))
            writers.append(item)
            if scenario.observers:
                observed.setdefault((backend + 1) % len(backends), []).append(name)
    for backend, names in observed.items():
        for start in range(0, len(names), settings.docs_per_socket):
            identity = next(users)
            socket = RealtimeSocket(
                _socket_url(backends[backend], identity.organization_id), identity.token, recorder
            )
            chunk = names[start : start + settings.docs_per_socket]
            sockets.append((socket, [replica(name, writer=False) for name in chunk]))
    return Layout(sockets, writers, replicas_by_doc)


async def _open(layout: Layout, settings: Settings) -> None:
    gate = asyncio.Semaphore(OPEN_CONCURRENCY)
    announce = settings.awareness is not Awareness.OFF
    keepalive = settings.awareness_seconds if announce else 0

    async def open_one(socket: RealtimeSocket, replicas: list[DocReplica]) -> None:
        async with gate:
            await socket.open(resync_seconds=settings.resync_seconds, awareness_seconds=keepalive)
            for item in replicas:
                socket.attach(item, announce=announce)

    await asyncio.gather(*(open_one(socket, replicas) for socket, replicas in layout.sockets))
    replicas = [item for items in layout.replicas_by_doc.values() for item in items]
    async with asyncio.timeout(SYNC_TIMEOUT_SECONDS):
        await asyncio.gather(*(item.synced.wait() for item in replicas))


async def _type(
    writer: DocReplica, interval: float, deadline: float, chars: int, rng: random.Random
) -> None:
    writer.place_cursor(rng.random())
    next_at = time.perf_counter() + rng.uniform(0, interval)
    while True:
        await asyncio.sleep(max(0.0, next_at - time.perf_counter()))
        now = time.perf_counter()
        if now >= deadline:
            break
        writer.edit("".join(rng.choices(TYPED_ALPHABET, k=chars)))
        # A late tick does not burst to catch up; a typist would not either.
        next_at = max(next_at + interval, now)
    writer.flush()


async def _loop_lag(samples: list[float]) -> None:
    while True:
        started = time.perf_counter()
        await asyncio.sleep(LOOP_TICK_SECONDS)
        samples.append((time.perf_counter() - started - LOOP_TICK_SECONDS) * 1000)


async def _drain(layout: Layout, timeout: float) -> float:
    started = time.perf_counter()
    replicas = [item for items in layout.replicas_by_doc.values() for item in items]
    while time.perf_counter() - started < timeout:
        if not any(item.unacked or item.unseen() for item in replicas):
            break
        await asyncio.sleep(DRAIN_POLL_SECONDS)
    return time.perf_counter() - started


async def run_scenario(
    scenario: Scenario,
    settings: Settings,
    identities: list[Identity],
    probes: Probes,
    api_url: str,
) -> dict[str, Any]:
    rng = random.Random(f"{settings.seed}:{scenario.name}")
    doc_ids = await create_notes(
        api_url,
        identities[0],
        scenario.documents,
        f"Qualification {scenario.name}",
        document_text(settings.doc_bytes, rng),
    )
    recorder = Recorder()
    layout = _layout(scenario, settings, doc_ids, identities, recorder)
    await _open(layout, settings)

    lag: list[float] = []
    lag_task = asyncio.create_task(_loop_lag(lag))
    window = await probes.begin(doc_ids)
    driver_cpu = time.process_time()
    edit_started = time.perf_counter()
    deadline = edit_started + settings.duration
    if scenario.edit_interval > 0:
        await asyncio.gather(
            *(
                _type(
                    writer,
                    scenario.edit_interval,
                    deadline,
                    settings.edit_chars,
                    random.Random(rng.random()),
                )
                for writer in layout.writers
            )
        )
    else:
        await asyncio.sleep(settings.duration)
    edit_seconds = time.perf_counter() - edit_started
    drain_seconds = await _drain(layout, settings.drain_timeout)
    await asyncio.sleep(settings.settle)
    window_seconds, postgres, valkey, cpu = await window.finish()
    driver_cpu = time.process_time() - driver_cpu
    lag_task.cancel()

    texts = {
        name: {str(item.text) for item in items} for name, items in layout.replicas_by_doc.items()
    }
    replicas = [item for items in layout.replicas_by_doc.values() for item in items]
    result = {
        "name": scenario.name,
        "workload": {
            "documents": scenario.documents,
            "writers_per_document": scenario.writers_per_document,
            "edit_interval_ms": round(scenario.edit_interval * 1000, 1),
            "edit_chars": settings.edit_chars,
            "batch_ms": round(settings.batch_seconds * 1000, 1),
            "doc_bytes": settings.doc_bytes,
            "sockets": len(layout.sockets),
            "observer_sockets": len(layout.sockets) - len(layout.writers),
            "edit_seconds": round(edit_seconds, 2),
            "drain_seconds": round(drain_seconds, 2),
            "settle_seconds": settings.settle,
        },
        "window_seconds": round(window_seconds, 2),
        "edits": {
            "made": sum(len(writer.log.clocks) for writer in layout.writers if writer.log),
            "frames": recorder.frames,
            "unacknowledged": sum(len(item.unacked) for item in replicas),
            "unseen": sum(item.unseen() for item in replicas),
            "converged": all(len(variants) == 1 for variants in texts.values()),
        },
        "latency_ms": {
            "acceptance": distribution(recorder.acceptance),
            "edit_to_ack": distribution(recorder.edit_to_ack),
            "visibility_from_edit": distribution(recorder.visibility_from_edit),
            "visibility_from_send": distribution(recorder.visibility_from_send),
        },
        "postgres": postgres,
        "valkey": valkey,
        "cpu": cpu,
        "driver": {"cpu_seconds": round(driver_cpu, 2), "loop_lag_ms": distribution(lag)},
        "errors": dict(recorder.errors),
    }
    await asyncio.gather(*(socket.close() for socket, _ in layout.sockets))
    return result
