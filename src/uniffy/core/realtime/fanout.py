"""Frames to attached clients, and accepted updates to peer replicas after their receipt."""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from loguru import logger

from uniffy.core.realtime.buffer_keys import Receipt
from uniffy.core.realtime.metrics import REALTIME_FRAMES_DROPPED_TOTAL
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.publisher import publish_doc_update
from uniffy.core.realtime.state import ClientHandle, DocKey, YDocSession, doc_name_for

logger = logger.bind(component="core.realtime.fanout")

_EFFECT_TIMEOUT_SECONDS = 2.0


def enqueue_for_handle(handle: ClientHandle, frame: bytes, *, kind: str) -> None:
    """Drop the frame when the socket's queue is full, so one slow reader never blocks a sender."""
    framed = encode_doc_frame(doc_name_for(handle.doc_key), frame)
    try:
        handle.ws_session.outbound.put_nowait(framed)
    except asyncio.QueueFull:
        REALTIME_FRAMES_DROPPED_TOTAL.labels(kind=f"outbound_full_{kind}").inc()
        logger.warning(f"outbound queue full for conn {handle.conn_id}; dropping {kind} frame")


def broadcast(session: YDocSession, frames: Sequence[bytes], *, skip: int | None = None) -> None:
    for frame in frames:
        for handle in list(session.clients.values()):
            if handle.conn_id != skip:
                enqueue_for_handle(handle, frame, kind="update")


def broadcast_awareness(session: YDocSession, frame: bytes, *, source_conn_id: int) -> None:
    for conn_id, peer in session.clients.items():
        if conn_id != source_conn_id:
            enqueue_for_handle(peer, frame, kind="awareness")


@dataclass(frozen=True, slots=True)
class AcceptedUpdate:
    update: bytes
    receipt: Receipt


class AcceptedEffects:
    """Publishes accepted updates in sequence order, then re-elects the seeder.

    Runs after the receipt and never delays it; a peer replica that misses a hint repairs on
    its next resync.
    """

    def __init__(
        self, replica_id: str, reelect_seeder: Callable[[YDocSession], Awaitable[None]]
    ) -> None:
        self._replica_id = replica_id
        self._reelect_seeder = reelect_seeder
        self._tasks: dict[DocKey, asyncio.Task[None]] = {}
        self._pending: dict[DocKey, list[AcceptedUpdate]] = {}

    def queue(self, session: YDocSession, accepted: AcceptedUpdate | None) -> None:
        pending = self._pending.setdefault(session.key, [])
        if accepted is not None:
            pending.append(accepted)
        if session.key not in self._tasks:
            self._tasks[session.key] = asyncio.create_task(self._deliver(session))

    async def drain(self, timeout: float) -> None:
        tasks = list(self._tasks.values())
        if tasks:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout)

    async def _deliver(self, session: YDocSession) -> None:
        key = session.key
        try:
            while key in self._pending:
                for accepted in self._pending.pop(key):
                    await _run(
                        publish_doc_update(
                            key[0],
                            key[1],
                            accepted.update,
                            generation=accepted.receipt.generation,
                            epoch=accepted.receipt.epoch,
                            sequence=accepted.receipt.seq,
                            origin_replica=self._replica_id,
                        )
                    )
                await _run(self._reelect_seeder(session))
        finally:
            self._tasks.pop(key, None)


async def _run(effect: Awaitable[None]) -> None:
    try:
        async with asyncio.timeout(_EFFECT_TIMEOUT_SECONDS):
            await effect
    except Exception:
        logger.exception("Realtime effect after acceptance failed")
