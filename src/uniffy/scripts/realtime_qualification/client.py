"""Multiplexed realtime sockets that follow the web client's protocol."""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections import Counter, deque
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
from uniffy.core.realtime.session import UNAVAILABLE_REASON
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_COMMITTED,
    MESSAGE_GENERATION,
    MESSAGE_SESSION_STATE,
    MESSAGE_UPDATE,
    Y_MESSAGE_AUTH,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    decode_state_vector,
    handle_sync_message,
    parse_accepted_receipt_message,
    parse_checkpoint_progress_message,
    parse_committed_message,
    parse_generation_message,
    parse_session_state_message,
)

# The web client sends a batch before its timer once it holds this many bytes.
BATCH_FLUSH_BYTES = 64 * 1024
MAX_INBOUND_BYTES = 16 * 1024 * 1024
# Clients keep a retryably refused update and resend it after a backoff that grows by half up to
# fifteen seconds; a receipt or commit while that backoff runs resends it at once.
UNAVAILABLE_RETRY_SECONDS = 5.0
UNAVAILABLE_RETRY_GROWTH = 1.5
UNAVAILABLE_RETRY_MAX_SECONDS = 15.0
COUNTED_MESSAGES = frozenset({
    MESSAGE_COMMITTED,
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_SESSION_STATE,
})

type SentCallback = Callable[[float], None]


@dataclass
class Recorder:
    """Latency samples in milliseconds, received frame counts and failures of one scenario."""

    acceptance: list[float] = field(default_factory=list)
    edit_to_acceptance: list[float] = field(default_factory=list)
    checkpoint_age: list[float] = field(default_factory=list)
    visibility_from_edit: list[float] = field(default_factory=list)
    visibility_from_send: list[float] = field(default_factory=list)
    received: Counter[int] = field(default_factory=Counter)
    errors: Counter[str] = field(default_factory=Counter)
    frames: int = 0


@dataclass
class EditLog:
    """Yjs clock each local edit of one writer reached, in edit order."""

    clocks: list[int] = field(default_factory=list)
    edited_at: list[float] = field(default_factory=list)
    sent_at: list[float | None] = field(default_factory=list)


@dataclass
class OwnUpdate:
    """One sent update, kept until a checkpoint covers it so an epoch reset can replay it."""

    body: bytes
    edits: list[int]
    sent_at: float | None = None
    accepted: bool = False
    measured: bool = False
    epoch: str | None = None
    sequence: int = 0


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
        self.epoch: str | None = None
        self.watermark = 0
        self.synced = asyncio.Event()
        self.cursor = 0
        self.awareness_clock = 0
        self.update_counter = 0
        self.batch: list[bytes] = []
        self.batch_bytes = 0
        self.batch_edits: list[int] = []
        self.batch_timer: asyncio.TimerHandle | None = None
        self.retry_timer: asyncio.TimerHandle | None = None
        self.retry_delay = UNAVAILABLE_RETRY_SECONDS
        # Ids sent and not yet answered, oldest first; the server answers writes in order.
        self.awaiting: deque[str] = deque()
        self.updates: dict[str, OwnUpdate] = {}
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
        if not self.batch or self.socket is None or self.generation is None:
            return
        update = self.batch[0] if len(self.batch) == 1 else pycrdt.merge_updates(*self.batch)
        edits = self.batch_edits
        self.batch, self.batch_bytes, self.batch_edits = [], 0, []
        self.update_counter += 1
        update_id = f"qualification-{self.client_id}:{self.update_counter}"
        body = (
            write_var_uint(MESSAGE_UPDATE)
            + write_var_string(self.generation)
            + write_var_string(update_id)
            + write_var_uint(len(update))
            + update
        )
        self.updates[update_id] = OwnUpdate(body, edits)
        self._send(update_id)

    def _send(self, update_id: str) -> None:
        own = self.updates[update_id]
        log = self.log
        if self.socket is None or log is None:
            return

        def stamp(sent: float) -> None:
            if own.sent_at is None:
                own.sent_at = sent
                for index in own.edits:
                    log.sent_at[index] = sent

        self.recorder.frames += 1
        self.socket.send(encode_doc_frame(self.name, own.body), on_sent=stamp)
        self.awaiting.append(update_id)

    def receive(self, payload: bytes, now: float) -> None:
        kind = payload[0]
        if kind in COUNTED_MESSAGES:
            self.recorder.received[kind] += 1
        if kind == MESSAGE_GENERATION:
            generation = parse_generation_message(payload)
            if self.generation is None:
                self.generation = generation
            elif generation != self.generation:
                self.recorder.errors["generation_changed"] += 1
        elif kind == MESSAGE_SESSION_STATE:
            state = parse_session_state_message(payload)
            if state.generation == self.generation:
                self._adopt_epoch(state.epoch, state.checkpoint_sequence, now)
        elif kind == MESSAGE_ACCEPTED_RECEIPT:
            receipt = parse_accepted_receipt_message(payload)
            self._answered(receipt.update_id)
            if receipt.generation == self.generation:
                self._accept(receipt.update_id, receipt.epoch, receipt.accepted_sequence, now)
            self._resume_saving()
        elif kind == MESSAGE_CHECKPOINT_PROGRESS:
            progress = parse_checkpoint_progress_message(payload)
            if (progress.generation, progress.epoch) == (self.generation, self.epoch):
                self.watermark = max(self.watermark, progress.covered_sequence)
                self._retire_covered(now)
        elif kind == MESSAGE_COMMITTED:
            update_id = parse_committed_message(payload)
            self._answered(update_id)
            if self._accept(update_id, self.epoch, 0, now):
                self._retire(update_id, now)
            self._resume_saving()
        elif kind == YMessageType.SYNC:
            # Own edits travel as updates under their ids, so a server SyncStep1 needs no reply.
            if payload[1] == YSyncMessageType.SYNC_STEP1:
                return
            handle_sync_message(payload[1:], self.doc)
            if payload[1] == YSyncMessageType.SYNC_STEP2 and self.generation is not None:
                self.synced.set()
            self._observe(now)
        elif kind == Y_MESSAGE_AUTH:
            _, offset = read_var_uint(payload, 1)
            reason = read_var_string(payload, offset)[0]
            self.recorder.errors[f"denied:{reason}"] += 1
            if reason == UNAVAILABLE_REASON:
                self._refuse_unavailable()

    def _adopt_epoch(self, epoch: str, checkpoint_sequence: int, now: float) -> None:
        changed = self.epoch is not None and epoch != self.epoch
        self.epoch = epoch
        self.watermark = checkpoint_sequence
        if changed:
            # Receipts of the retired epoch prove nothing; every uncovered update goes out again.
            self.recorder.errors["epoch_changed"] += 1
            for update_id, own in self.updates.items():
                own.accepted = False
                self._send(update_id)
        self._retire_covered(now)

    def _accept(self, update_id: str, epoch: str | None, sequence: int, now: float) -> bool:
        own = self.updates.get(update_id)
        if own is None:
            self.recorder.errors["unexpected_answer"] += 1
            return False
        if epoch != self.epoch:
            return False
        own.accepted, own.epoch, own.sequence = True, epoch, sequence
        if not own.measured and own.sent_at is not None and self.log is not None:
            own.measured = True
            self.recorder.acceptance.append((now - own.sent_at) * 1000)
            self.recorder.edit_to_acceptance.extend(
                (now - self.log.edited_at[index]) * 1000 for index in own.edits
            )
        if sequence and sequence <= self.watermark:
            self._retire(update_id, now)
        return True

    def _retire_covered(self, now: float) -> None:
        covered = [
            update_id
            for update_id, own in self.updates.items()
            if own.accepted and own.epoch == self.epoch and own.sequence <= self.watermark
        ]
        for update_id in covered:
            self._retire(update_id, now)

    def _retire(self, update_id: str, now: float) -> None:
        own = self.updates.pop(update_id, None)
        if own is None or self.log is None:
            return
        self.recorder.checkpoint_age.extend(
            (now - self.log.edited_at[index]) * 1000 for index in own.edits
        )

    def _answered(self, update_id: str) -> None:
        with contextlib.suppress(ValueError):
            self.awaiting.remove(update_id)

    def _refuse_unavailable(self) -> None:
        # The refusal answers the oldest write in flight; later ones may still be accepted.
        if self.awaiting:
            self.awaiting.popleft()
        if self.retry_timer is not None:
            return
        self.retry_timer = asyncio.get_running_loop().call_later(
            self.retry_delay, self._resend_refused
        )
        self.retry_delay = min(
            self.retry_delay * UNAVAILABLE_RETRY_GROWTH, UNAVAILABLE_RETRY_MAX_SECONDS
        )

    def _resume_saving(self) -> None:
        # The server takes writes again, so refused updates need not wait out their backoff.
        self.retry_delay = UNAVAILABLE_RETRY_SECONDS
        if self.retry_timer is not None:
            self._resend_refused()

    def _resend_refused(self) -> None:
        if self.retry_timer is not None:
            self.retry_timer.cancel()
            self.retry_timer = None
        for update_id, own in self.updates.items():
            if not own.accepted and update_id not in self.awaiting:
                self._send(update_id)

    def unaccepted(self) -> int:
        return sum(not own.accepted for own in self.updates.values())

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
        for replica in self.replicas.values():
            if replica.retry_timer is not None:
                replica.retry_timer.cancel()
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
                if replica is None or len(message) <= offset:
                    continue
                try:
                    replica.receive(message[offset:], now)
                except ValueError:
                    self.recorder.errors[f"malformed:{message[offset]}"] += 1
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
