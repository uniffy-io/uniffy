"""Multiplexed realtime sockets that follow the web client's current protocol."""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import quote

import pycrdt
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed
from websockets.typing import Subprotocol

from uniffy.core.json_codec import dumps_str
from uniffy.core.realtime.auth import CANONICAL_SUBPROTOCOL
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    peek_var_string,
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
from uniffy.core.realtime.wire import (
    MESSAGE_ACK,
    MESSAGE_DURABLE_UPDATE,
    MESSAGE_GENERATION,
    Y_MESSAGE_AUTH,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
)

# The web client sends a batch before its timer once it holds this many bytes.
BATCH_FLUSH_BYTES = 64 * 1024
MAX_INBOUND_BYTES = 16 * 1024 * 1024

type SentCallback = Callable[[float], None]


@dataclass
class Recorder:
    """Latency samples in milliseconds and failures shared by one scenario."""

    acceptance: list[float] = field(default_factory=list)
    edit_to_ack: list[float] = field(default_factory=list)
    visibility_from_edit: list[float] = field(default_factory=list)
    visibility_from_send: list[float] = field(default_factory=list)
    errors: Counter[str] = field(default_factory=Counter)
    frames: int = 0


@dataclass
class EditLog:
    """Yjs clock each local edit of one writer reached, in edit order."""

    clocks: list[int] = field(default_factory=list)
    edited_at: list[float] = field(default_factory=list)
    sent_at: list[float | None] = field(default_factory=list)


def decode_state_vector(raw: bytes) -> dict[int, int]:
    count, offset = read_var_uint(raw, 0)
    state: dict[int, int] = {}
    for _ in range(count):
        client, offset = read_var_uint(raw, offset)
        clock, offset = read_var_uint(raw, offset)
        state[client] = clock
    return state


class DocReplica:
    """One attached copy of a document; peers find a writer's edit by its Yjs clock."""

    def __init__(
        self,
        name: str,
        client_id: int,
        edit_logs: dict[int, EditLog],
        recorder: Recorder,
        *,
        writer: bool,
        batch_seconds: float,
        awareness_per_edit: bool,
    ) -> None:
        self.name = name
        self.client_id = client_id
        self.doc = pycrdt.Doc(client_id=client_id)
        self.text = markdown_text(self.doc)
        self.edit_logs = edit_logs
        self.log = edit_logs.setdefault(client_id, EditLog()) if writer else None
        self.recorder = recorder
        self.batch_seconds = batch_seconds
        self.awareness_per_edit = awareness_per_edit
        self.socket: RealtimeSocket | None = None
        self.generation: str | None = None
        self.synced = asyncio.Event()
        self.cursor = 0
        self.awareness_clock = 0
        self.update_counter = 0
        self.batch: list[bytes] = []
        self.batch_bytes = 0
        self.batch_edits: list[int] = []
        self.batch_timer: asyncio.TimerHandle | None = None
        self.unacked: dict[str, tuple[float, list[int]]] = {}
        self.delivered: dict[int, int] = {}

    def place_cursor(self, fraction: float) -> None:
        self.cursor = int(len(self.text) * fraction)

    def edit(self, chars: str) -> None:
        if self.log is None or self.socket is None:
            raise RuntimeError(f"{self.name} is not an attached writer")
        before = self.doc.get_state()
        self.cursor = min(self.cursor, len(self.text))
        self.text.insert(self.cursor, chars)
        self.cursor += len(chars)
        update = self.doc.get_update(before)
        self.log.clocks.append(decode_state_vector(self.doc.get_state())[self.client_id])
        self.log.edited_at.append(time.perf_counter())
        self.log.sent_at.append(None)
        self.batch.append(update)
        self.batch_bytes += len(update)
        self.batch_edits.append(len(self.log.clocks) - 1)
        if self.awareness_per_edit:
            self.socket.send(self.awareness_frame())
        if self.batch_seconds <= 0 or self.batch_bytes >= BATCH_FLUSH_BYTES:
            self.flush()
        elif self.batch_timer is None:
            # The first edit fixes the deadline, so continuous typing cannot postpone a send.
            self.batch_timer = asyncio.get_running_loop().call_later(self.batch_seconds, self.flush)

    def flush(self) -> None:
        if self.batch_timer is not None:
            self.batch_timer.cancel()
            self.batch_timer = None
        if not self.batch or self.socket is None or self.generation is None or self.log is None:
            return
        update = self.batch[0] if len(self.batch) == 1 else pycrdt.merge_updates(*self.batch)
        edits = self.batch_edits
        log = self.log
        self.batch, self.batch_bytes, self.batch_edits = [], 0, []
        self.update_counter += 1
        update_id = f"qualification-{self.client_id}:{self.update_counter}"
        body = (
            write_var_uint(MESSAGE_DURABLE_UPDATE)
            + write_var_string(self.generation)
            + write_var_string(update_id)
            + write_var_uint(len(update))
            + update
        )

        def stamp(sent: float) -> None:
            self.unacked[update_id] = (sent, edits)
            for index in edits:
                log.sent_at[index] = sent

        self.recorder.frames += 1
        self.socket.send(encode_doc_frame(self.name, body), on_sent=stamp)

    def receive(self, payload: bytes, now: float) -> None:
        kind = payload[0]
        if kind == MESSAGE_GENERATION:
            generation, _ = read_var_string(payload, 1)
            if self.generation is None:
                self.generation = generation
            elif generation != self.generation:
                self.recorder.errors["generation_changed"] += 1
        elif kind == MESSAGE_ACK:
            self._acknowledge(read_var_string(payload, 1)[0], now)
        elif kind == YMessageType.SYNC:
            # Local edits travel as durable updates, so a server SyncStep1 never needs a reply.
            if payload[1] == YSyncMessageType.SYNC_STEP1:
                return
            handle_sync_message(payload[1:], self.doc)
            if payload[1] == YSyncMessageType.SYNC_STEP2 and self.generation is not None:
                self.synced.set()
            self._observe(now)
        elif kind == Y_MESSAGE_AUTH:
            _, offset = read_var_uint(payload, 1)
            self.recorder.errors[f"denied:{read_var_string(payload, offset)[0]}"] += 1

    def _acknowledge(self, update_id: str, now: float) -> None:
        pending = self.unacked.pop(update_id, None)
        if pending is None or self.log is None:
            self.recorder.errors["unexpected_ack"] += 1
            return
        sent, edits = pending
        self.recorder.acceptance.append((now - sent) * 1000)
        self.recorder.edit_to_ack.extend((now - self.log.edited_at[i]) * 1000 for i in edits)

    def _observe(self, now: float) -> None:
        state = decode_state_vector(self.doc.get_state())
        for writer, log in self.edit_logs.items():
            if writer == self.client_id:
                continue
            clock = state.get(writer, 0)
            index = self.delivered.get(writer, 0)
            while index < len(log.clocks) and log.clocks[index] <= clock:
                self.recorder.visibility_from_edit.append((now - log.edited_at[index]) * 1000)
                sent = log.sent_at[index]
                if sent is not None:
                    self.recorder.visibility_from_send.append((now - sent) * 1000)
                index += 1
            self.delivered[writer] = index

    def unseen(self) -> int:
        return sum(
            len(log.clocks) - self.delivered.get(writer, 0)
            for writer, log in self.edit_logs.items()
            if writer != self.client_id
        )

    def sync_frame(self) -> bytes:
        return encode_doc_frame(self.name, create_sync_message(self.doc))

    def awareness_frame(self) -> bytes:
        self.awareness_clock += 1
        state = dumps_str({"cursor": {"anchor": self.cursor, "head": self.cursor}})
        update = (
            write_var_uint(1)
            + write_var_uint(self.client_id)
            + write_var_uint(self.awareness_clock)
            + write_var_string(state)
        )
        body = write_var_uint(YMessageType.AWARENESS) + write_var_uint(len(update)) + update
        return encode_doc_frame(self.name, body)


class RealtimeSocket:
    """One browser tab: a single socket that carries every attached document."""

    def __init__(self, url: str, token: str, recorder: Recorder) -> None:
        self.url = url
        self.token = token
        self.recorder = recorder
        self.replicas: dict[str, DocReplica] = {}
        self.outbound: asyncio.Queue[tuple[bytes, SentCallback | None]] = asyncio.Queue()
        self.connection: ClientConnection | None = None
        self.tasks: list[asyncio.Task[None]] = []
        self.closing = False

    async def open(self, *, resync_seconds: float, awareness_seconds: float) -> None:
        # Browsers carry the token in the subprotocol list; the server echoes only the canonical one.
        self.connection = await connect(
            self.url,
            subprotocols=[
                Subprotocol(CANONICAL_SUBPROTOCOL),
                Subprotocol(f"bearer.{quote(self.token, safe='')}"),
            ],
            max_size=MAX_INBOUND_BYTES,
            ping_interval=None,
            open_timeout=30,
            close_timeout=5,
        )
        self.tasks = [
            asyncio.create_task(self._read()),
            asyncio.create_task(self._write()),
        ]
        if resync_seconds > 0:
            self.tasks.append(
                asyncio.create_task(self._repeat(resync_seconds, DocReplica.sync_frame))
            )
        if awareness_seconds > 0:
            self.tasks.append(
                asyncio.create_task(self._repeat(awareness_seconds, DocReplica.awareness_frame))
            )

    def attach(self, replica: DocReplica, *, announce: bool) -> None:
        replica.socket = self
        self.replicas[replica.name] = replica
        self.send(replica.sync_frame())
        if announce:
            self.send(replica.awareness_frame())

    def send(self, frame: bytes, on_sent: SentCallback | None = None) -> None:
        self.outbound.put_nowait((frame, on_sent))

    async def close(self) -> None:
        self.closing = True
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with contextlib.suppress(asyncio.CancelledError, ConnectionClosed):
                await task
        if self.connection is not None:
            with contextlib.suppress(Exception):
                await self.connection.close()

    async def _write(self) -> None:
        if self.connection is None:
            return
        while True:
            frame, on_sent = await self.outbound.get()
            if on_sent is not None:
                on_sent(time.perf_counter())
            try:
                await self.connection.send(frame)
            except ConnectionClosed:
                self.recorder.errors["send_after_close"] += 1
                return

    async def _read(self) -> None:
        if self.connection is None:
            return
        try:
            async for message in self.connection:
                if isinstance(message, str):
                    continue
                now = time.perf_counter()
                name, offset = peek_var_string(message)
                replica = self.replicas.get(name)
                if replica is not None and len(message) > offset:
                    replica.receive(message[offset:], now)
        except ConnectionClosed:
            pass
        if not self.closing:
            self.recorder.errors[f"closed:{self.connection.close_code}"] += 1

    async def _repeat(self, seconds: float, frame: Callable[[DocReplica], bytes]) -> None:
        # Mirrors the web client's periodic SyncStep1 resync and awareness keepalive.
        while True:
            await asyncio.sleep(seconds)
            for replica in self.replicas.values():
                self.send(frame(replica))
