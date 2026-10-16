"""Real in-process sockets against resident replicas whose live edits go through the buffer."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote
from uuid import UUID

import pycrdt
import pytest
import pytest_asyncio
from fastapi import WebSocketDisconnect
from sqlalchemy import update

from uniffy.core.auth.tokens import create_access_token
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime import storage, ws_routes
from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_UNAUTHENTICATED,
    WS_CLOSE_UPGRADE_REQUIRED,
)
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    peek_var_string,
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
from uniffy.core.realtime.publisher import publish_checkpoint_progress
from uniffy.core.realtime.router import RealtimeRouter
from uniffy.core.realtime.session import MSG_QUERY_AWARENESS, run_multiplexed_session
from uniffy.core.realtime.state import DocKey, WSSession, doc_name_for
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_ACK,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_DURABLE_UPDATE,
    MESSAGE_FRAGMENT_SEEDER,
    MESSAGE_GENERATION,
    MESSAGE_SEED_CAPABILITY,
    MESSAGE_SEED_UPDATE,
    MESSAGE_SESSION_STATE,
    Y_MESSAGE_AUTH,
    AcceptedReceipt,
    CheckpointProgress,
    SessionState,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
    parse_accepted_receipt_message,
    parse_ack_message,
    parse_checkpoint_progress_message,
    parse_generation_message,
    parse_session_state_message,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    buffering_disabled,
    document,
    fragment_edit,
    fragment_of,
    live_note,  # noqa: F401 - fixture
    stored,
    text_of,
    typed,
    unreachable,
    valkey,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

FRAME_TIMEOUT = 5.0
QUIET_SECONDS = 0.3
UNAVAILABLE = "unavailable"


class Socket:
    """An in-process WebSocket; the test plays the client end."""

    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = (
            {"sec-websocket-protocol": CANONICAL_SUBPROTOCOL} if headers is None else headers
        )
        self.subprotocols: list[str | None] = []
        self.closes: list[tuple[int, str | None]] = []
        self.hold_accept: asyncio.Event | None = None
        self.accept_error: Exception | None = None
        self.accepting = asyncio.Event()
        self.sent: asyncio.Queue[bytes] = asyncio.Queue()
        self._inbound: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def accept(self, subprotocol: str | None = None) -> None:
        self.accepting.set()
        if self.hold_accept is not None:
            await self.hold_accept.wait()
        if self.accept_error is not None:
            raise self.accept_error
        self.subprotocols.append(subprotocol)

    async def receive_bytes(self) -> bytes:
        frame = await self._inbound.get()
        if frame is None:
            raise WebSocketDisconnect(1000)
        return frame

    async def send_bytes(self, data: bytes) -> None:
        self.sent.put_nowait(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closes.append((code, reason))
        self._inbound.put_nowait(None)

    def deliver(self, frame: bytes) -> None:
        self._inbound.put_nowait(frame)

    def hang_up(self) -> None:
        self._inbound.put_nowait(None)


@dataclass
class Client:
    """One socket attached to one document; ``doc`` follows the sync frames it receives."""

    socket: Socket
    task: asyncio.Task[None]
    key: DocKey
    doc: pycrdt.Doc = field(default_factory=pycrdt.Doc)

    def send(self, payload: bytes) -> None:
        self.socket.deliver(encode_doc_frame(doc_name_for(self.key), payload))

    def sync(self) -> None:
        self.send(create_sync_message(self.doc))

    def write(self, update_id: str, update: bytes, generation: str) -> None:
        self.send(
            bytes([MESSAGE_DURABLE_UPDATE])
            + write_var_string(generation)
            + write_var_string(update_id)
            + write_var_uint(len(update))
            + update
        )

    async def receive(self) -> bytes:
        while True:
            frame = await self.socket.sent.get()
            name, offset = peek_var_string(frame)
            if name != doc_name_for(self.key):
                continue
            payload = frame[offset:]
            if payload[0] == YMessageType.SYNC:
                handle_sync_message(payload[1:], self.doc)
            return payload

    async def until(
        self,
        kind: int,
        where: Callable[[bytes], bool] = lambda _: True,
        timeout: float = FRAME_TIMEOUT,
    ) -> tuple[bytes, list[bytes]]:
        """The first frame of ``kind`` that satisfies ``where``, and every frame before it."""
        seen: list[bytes] = []
        async with asyncio.timeout(timeout):
            while True:
                payload = await self.receive()
                if payload[0] == kind and where(payload):
                    return payload, seen
                seen.append(payload)

    async def drain(self) -> list[bytes]:
        """Every frame that arrives before the socket goes quiet."""
        frames: list[bytes] = []
        with contextlib.suppress(TimeoutError):
            while True:
                async with asyncio.timeout(QUIET_SECONDS):
                    frames.append(await self.receive())
        return frames

    async def receipt(self) -> AcceptedReceipt:
        frame, _ = await self.until(MESSAGE_ACCEPTED_RECEIPT)
        return parse_accepted_receipt_message(frame)

    async def text(self, expected: str) -> None:
        async with asyncio.timeout(FRAME_TIMEOUT):
            while str(markdown_text(self.doc)) != expected:
                await self.receive()

    async def leave(self) -> None:
        self.socket.hang_up()
        await self.task


def trimmed(*history: bytes) -> bytes:
    """A client edit deleting the first character."""
    doc = document(*history)
    before = doc.get_state()
    del markdown_text(doc)[:1]
    return doc.get_update(before)


def announces(epoch: str) -> Callable[[bytes], bool]:
    """Checkpoint progress naming ``epoch``."""
    return lambda payload: (
        payload[0] == MESSAGE_CHECKPOINT_PROGRESS
        and parse_checkpoint_progress_message(payload).epoch == epoch
    )


def step(sub_type: int) -> Callable[[bytes], bool]:
    return lambda payload: payload[1] == sub_type


def kinds(frames: list[bytes]) -> list[int]:
    return [frame[0] for frame in frames]


def denial(payload: bytes) -> tuple[int, str]:
    scope, offset = read_var_uint(payload, 1)
    reason, _ = read_var_string(payload, offset)
    return scope, reason


def seed_proposal(generation: str, request: str, token: str, base: str, update: bytes) -> bytes:
    return (
        bytes([MESSAGE_SEED_UPDATE])
        + write_var_string(generation)
        + write_var_string(request)
        + write_var_string(token)
        + write_var_string(base)
        + write_var_uint(len(update))
        + update
    )


def awareness(client_id: int, state: dict[str, Any] | None) -> bytes:
    body = (
        write_var_uint(1)
        + write_var_uint(client_id)
        + write_var_uint(1)
        + write_var_string(dumps_str(state))
    )
    return bytes([YMessageType.AWARENESS]) + write_var_uint(len(body)) + body


def awareness_state(payload: bytes) -> dict[str, Any]:
    _, offset = read_var_uint(payload, 1)
    for _ in range(3):
        _, offset = read_var_uint(payload, offset)
    raw, _ = read_var_string(payload, offset, max_bytes=len(payload))
    return loads(raw)


def resident_text(manager: YDocManager, key: DocKey) -> str:
    session = manager.resident(key)
    assert session is not None
    return str(markdown_text(session.ydoc))


async def attach(
    manager: YDocManager, document: BufferedDocument, user: UUID | None = None
) -> tuple[Client, list[bytes]]:
    """Open a socket and attach the document; returns every frame before the sync reply."""
    socket = Socket()
    session = WSSession(
        user_id=user or document.owner,
        organization_id=document.org,
        token_version=1,
        conn_id=id(socket),
        ws=socket,
    )
    task = asyncio.create_task(run_multiplexed_session(socket, session, manager))
    client = Client(socket, task, document.key)
    client.sync()
    _, frames = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    return client, frames


def session_state(frames: list[bytes]) -> SessionState:
    return parse_session_state_message(next(f for f in frames if f[0] == MESSAGE_SESSION_STATE))


async def evicted(manager: YDocManager, key: DocKey) -> None:
    async with asyncio.timeout(FRAME_TIMEOUT):
        while manager.resident(key) is not None:
            await asyncio.sleep(0.02)


def replica(buffer: UpdateBuffer) -> YDocManager:
    name = f"replica-{generate_id().hex}"
    return YDocManager(
        buffer=buffer,
        realtime_router=RealtimeRouter(name),
        replica=name,
        idle_eviction_seconds=0.05,
    )


@pytest_asyncio.fixture(loop_scope="session")
async def manager(live_note: BufferedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(live_note.buffer)
    yield manager
    await manager.stop_for_shutdown()
    await evicted(manager, live_note.key)


@contextlib.asynccontextmanager
async def routed(buffer: UpdateBuffer, count: int) -> AsyncIterator[list[YDocManager]]:
    """Resident replicas in this process whose routers subscribe to real Valkey pubsub."""
    await init_pubsub()
    replicas: list[YDocManager] = []
    try:
        for _ in range(count):
            replicas.append(replica(buffer))
            replicas[-1].realtime_router.register_callbacks(replicas[-1].router_callbacks())
            await replicas[-1].realtime_router.start()
        yield replicas
    finally:
        for each in replicas:
            await each.realtime_router.stop()
            await each.stop_for_shutdown()
        await close_pubsub()


async def subscribed(client: Client, state: SessionState) -> None:
    """Wait until the client's replica receives this document's pubsub traffic."""
    for _ in range(100):
        await publish_checkpoint_progress(
            *client.key,
            generation=state.generation,
            epoch=state.epoch,
            covered_sequence=0,
            checkpoint_revision=state.checkpoint_revision,
        )
        with contextlib.suppress(TimeoutError):
            await client.until(MESSAGE_CHECKPOINT_PROGRESS, timeout=0.1)
            return
    raise AssertionError("replica never received document pubsub traffic")


async def test_attach_and_resync_send_generation_then_session_state_before_sync(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, frames = await attach(manager, live_note)
    reconnect, again = await attach(manager, live_note)
    try:
        row = await stored(live_note.key)
        # The attach handshake already answers the first SyncStep1, so it is not repeated.
        assert kinds(frames) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE, YMessageType.SYNC]
        assert frames[2][1] == YSyncMessageType.SYNC_STEP1
        assert parse_generation_message(frames[0]) == live_note.generation
        expected = SessionState(live_note.generation, live_note.head.scope.epoch, 0, 0, row.revision)
        assert parse_session_state_message(frames[1]) == expected
        assert kinds(again) == kinds(frames)
        client.sync()
        _, resync = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
        assert kinds(resync) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE]
        assert parse_session_state_message(resync[1]) == expected
        assert str(markdown_text(client.doc)) == "base"
    finally:
        await reconnect.leave()
        await client.leave()


async def test_edit_answers_receipt_and_leaves_snapshot_row_unchanged(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, frames = await attach(manager, live_note)
    try:
        before = await stored(live_note.key)
        client.write("edit-1", typed(live_note.base, suffix=" typed"), live_note.generation)
        receipt = await client.receipt()
        after = await stored(live_note.key)
        assert receipt == AcceptedReceipt(
            "edit-1", live_note.generation, session_state(frames).epoch, 1
        )
        assert (after.revision, after.updates, after.checkpoint_seq) == (
            before.revision,
            before.updates,
            before.checkpoint_seq,
        )
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base typed"
    finally:
        await client.leave()


async def test_duplicate_update_id_answers_the_same_sequence(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    edit = typed(live_note.base, suffix=" once")
    try:
        client.write("edit-1", edit, live_note.generation)
        first = await client.receipt()
        client.write("edit-1", edit, live_note.generation)
        assert await client.receipt() == first
        assert first.accepted_sequence == 1
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base once"
    finally:
        await client.leave()


async def test_sync_reply_with_only_known_deletions_appends_nothing(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    edit = trimmed(live_note.base)
    # What a client answers a server SyncStep1 with once it holds the deletion.
    reply = document(live_note.base, edit).get_update(document(live_note.base, edit).get_state())
    try:
        client.write("edit-1", edit, live_note.generation)
        first = await client.receipt()
        client.write("reply-1", reply, live_note.generation)
        assert await client.receipt() == AcceptedReceipt(
            "reply-1", live_note.generation, first.epoch, 1
        )
        assert await live_note.stream_ids() == [b"1-0"]

        scope = BufferScope(live_note.org, *live_note.key, first.generation, first.epoch)
        result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
        assert result.status is CheckpointStatus.COMMITTED
        before = await stored(live_note.key)
        client.write("reply-2", reply, live_note.generation)
        ack, seen = await client.until(MESSAGE_ACK)
        assert parse_ack_message(ack) == "reply-2"
        # The new checkpoint repeats known deletions only, so no update frame precedes the ack.
        assert seen == []
        after = await stored(live_note.key)
        assert (after.revision, after.updates) == (before.revision, before.updates)
        assert await live_note.stream_ids() == []
        assert await valkey().zscore(live_note.keys.due, live_note.head.scope.member) is None
        assert resident_text(manager, live_note.key) == "ase"
    finally:
        await client.leave()


async def test_reused_update_id_with_different_bytes_is_refused(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    try:
        client.write("edit-1", typed(live_note.base, suffix=" first"), live_note.generation)
        await client.receipt()
        client.write("edit-1", typed(live_note.base, suffix=" other"), live_note.generation)
        refusal, seen = await client.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, "update conflict")
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base first"
    finally:
        await client.leave()


async def test_malformed_update_is_refused_without_closing_the_socket(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    generation = write_var_string(live_note.generation)
    try:
        for payload in (
            b"\x06",
            b"\x08\xff",
            b"\x06" + generation + b"\x01i\x02x",
            b"\x06" + generation + b"\x01i\x01x",
        ):
            client.send(payload)
            refusal, _ = await client.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, "invalid update")
        client.write("edit-1", typed(live_note.base, suffix=" valid"), live_note.generation)
        assert (await client.receipt()).accepted_sequence == 1
        assert client.socket.closes == []
    finally:
        await client.leave()


async def test_worker_checkpoint_reaches_attached_client_as_progress(
    live_note: BufferedDocument,
) -> None:
    async with routed(live_note.buffer, 1) as (manager,):
        client, frames = await attach(manager, live_note)
        try:
            await subscribed(client, session_state(frames))
            client.write("edit-1", typed(live_note.base, suffix=" saved"), live_note.generation)
            receipt = await client.receipt()
            scope = BufferScope(live_note.org, *live_note.key, receipt.generation, receipt.epoch)
            result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
            assert result.status is CheckpointStatus.COMMITTED
            frame, _ = await client.until(
                MESSAGE_CHECKPOINT_PROGRESS,
                lambda payload: parse_checkpoint_progress_message(payload).covered_sequence > 0,
            )
            row = await stored(live_note.key)
            assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
                receipt.generation, receipt.epoch, receipt.accepted_sequence, row.revision
            )
            client.sync()
            frame, _ = await client.until(MESSAGE_SESSION_STATE)
            assert parse_session_state_message(frame) == SessionState(
                receipt.generation, receipt.epoch, 1, 1, row.revision
            )
        finally:
            await client.leave()
            await evicted(manager, live_note.key)


async def test_lost_control_record_sends_fresh_session_state_then_receipt_in_new_epoch(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, frames = await attach(manager, live_note)
    kept = typed(live_note.base, suffix=" kept")
    try:
        client.write("edit-1", kept, live_note.generation)
        assert (await client.receipt()).accepted_sequence == 1
        await valkey().delete(live_note.keys.control)
        client.write("edit-2", typed(live_note.base, kept, suffix=" next"), live_note.generation)
        frame, seen = await client.until(MESSAGE_ACCEPTED_RECEIPT)
        receipt = parse_accepted_receipt_message(frame)
        fresh = session_state(seen)
        row = await stored(live_note.key)
        assert fresh.epoch not in (session_state(frames).epoch, "")
        assert fresh == SessionState(live_note.generation, fresh.epoch, 0, 0, row.revision)
        assert receipt == AcceptedReceipt("edit-2", live_note.generation, fresh.epoch, 1)
        assert row.buffer_epoch == fresh.epoch
        # The surviving record of the lost epoch moved into the checkpoint before the reset.
        assert text_of(row.updates) == "base kept"
        assert resident_text(manager, live_note.key) == "base kept next"
    finally:
        await client.leave()


async def test_progress_for_a_retired_epoch_reaches_no_client(live_note: BufferedDocument) -> None:
    async with routed(live_note.buffer, 1) as (manager,):
        client, frames = await attach(manager, live_note)
        try:
            await subscribed(client, session_state(frames))
            kept = typed(live_note.base, suffix=" kept")
            client.write("edit-1", kept, live_note.generation)
            retired = await client.receipt()
            await valkey().delete(live_note.keys.control)
            client.write("edit-2", typed(live_note.base, kept, suffix=" next"), live_note.generation)
            frame, seen = await client.until(MESSAGE_ACCEPTED_RECEIPT)
            fresh = parse_accepted_receipt_message(frame)
            assert fresh.epoch != retired.epoch
            # The reset announces the fresh epoch; take that frame before the stale one is sent.
            if not any(announces(fresh.epoch)(payload) for payload in seen):
                await client.until(MESSAGE_CHECKPOINT_PROGRESS, announces(fresh.epoch))
            row = await stored(live_note.key)

            await publish_checkpoint_progress(
                *live_note.key,
                generation=retired.generation,
                epoch=retired.epoch,
                covered_sequence=1,
                checkpoint_revision=row.revision,
            )
            await publish_checkpoint_progress(
                *live_note.key,
                generation=fresh.generation,
                epoch=fresh.epoch,
                covered_sequence=0,
                checkpoint_revision=row.revision,
            )
            frame, seen = await client.until(MESSAGE_CHECKPOINT_PROGRESS)
            assert parse_checkpoint_progress_message(frame).epoch == fresh.epoch
            assert MESSAGE_CHECKPOINT_PROGRESS not in kinds(seen)
            client.sync()
            frame, _ = await client.until(MESSAGE_SESSION_STATE)
            assert parse_session_state_message(frame) == SessionState(
                fresh.generation, fresh.epoch, 1, 0, row.revision
            )
        finally:
            await client.leave()
            await evicted(manager, live_note.key)


@pytest.mark.parametrize("revision", ["advanced", "already_known"])
async def test_progress_ahead_of_a_missed_hint_reloads_the_record_before_announcing_it(
    live_note: BufferedDocument, revision: str
) -> None:
    async with routed(live_note.buffer, 2) as (left, right):
        author, author_frames = await attach(left, live_note)
        reader, reader_frames = await attach(right, live_note)
        try:
            state = session_state(reader_frames)
            await subscribed(author, state)
            await subscribed(reader, state)
            await right.realtime_router.stop()
            author.write("edit-1", typed(live_note.base, suffix=" one"), live_note.generation)
            receipt = await author.receipt()
            scope = BufferScope(live_note.org, *live_note.key, receipt.generation, receipt.epoch)
            result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
            assert result.status is CheckpointStatus.COMMITTED
            await right.realtime_router.start()
            await subscribed(reader, state)
            assert resident_text(right, live_note.key) == "base"

            row = await stored(live_note.key)
            announced = row.revision if revision == "advanced" else state.checkpoint_revision
            await publish_checkpoint_progress(
                *live_note.key,
                generation=receipt.generation,
                epoch=receipt.epoch,
                covered_sequence=1,
                checkpoint_revision=announced,
            )
            frame, _ = await reader.until(
                MESSAGE_CHECKPOINT_PROGRESS,
                lambda payload: parse_checkpoint_progress_message(payload).covered_sequence == 1,
            )
            assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
                receipt.generation, receipt.epoch, 1, announced
            )
            assert str(markdown_text(reader.doc)) == "base one"
            assert resident_text(right, live_note.key) == "base one"
        finally:
            await author.leave()
            await reader.leave()
            await evicted(left, live_note.key)
            await evicted(right, live_note.key)


async def test_epoch_reset_on_one_replica_moves_the_clients_of_another(
    live_note: BufferedDocument,
) -> None:
    async with routed(live_note.buffer, 2) as (left, right):
        author, author_frames = await attach(left, live_note)
        reader, reader_frames = await attach(right, live_note)
        try:
            state = session_state(reader_frames)
            await subscribed(author, state)
            await subscribed(reader, state)
            await valkey().delete(live_note.keys.control)
            # A resync reads the lost epoch and resets it without appending anything.
            author.sync()
            frame, _ = await author.until(
                MESSAGE_SESSION_STATE,
                lambda payload: parse_session_state_message(payload).epoch != state.epoch,
            )
            fresh = parse_session_state_message(frame)
            frame, seen = await reader.until(MESSAGE_CHECKPOINT_PROGRESS, announces(fresh.epoch))
            assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
                fresh.generation, fresh.epoch, 0, fresh.checkpoint_revision
            )
            assert session_state(seen) == fresh
            assert seen[-1][:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP1])
        finally:
            await author.leave()
            await reader.leave()
            await evicted(left, live_note.key)
            await evicted(right, live_note.key)


async def test_disabled_buffering_refuses_as_unavailable_and_keeps_resident(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    try:
        async with buffering_disabled():
            client.write("edit-1", typed(live_note.base, suffix=" refused"), live_note.generation)
            refusal, seen = await client.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, UNAVAILABLE)
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await live_note.stream_ids() == []
        assert resident_text(manager, live_note.key) == "base"
    finally:
        await client.leave()


async def test_unreachable_buffer_refuses_as_unavailable_and_keeps_resident(
    live_note: BufferedDocument,
) -> None:
    async with unreachable(live_note.namespace) as buffer:
        manager = replica(buffer)
        client, frames = await attach(manager, live_note)
        try:
            # Without a readable buffer the checkpoint alone seeds the document, without epoch.
            assert MESSAGE_SESSION_STATE not in kinds(frames)
            client.write("edit-1", typed(live_note.base, suffix=" refused"), live_note.generation)
            refusal, seen = await client.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, UNAVAILABLE)
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
            assert resident_text(manager, live_note.key) == "base"
        finally:
            await client.leave()
            await evicted(manager, live_note.key)
    assert await live_note.stream_ids() == []


async def test_seed_proposal_commits_with_the_buffered_tail_and_answers_committed_ack(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    # Longer than the 4 KiB identifier cap, so the source string uses the frame limit.
    source = "base" + "é" * 3000
    grown = typed(live_note.base, suffix=source[4:])
    client, _ = await attach(manager, live_note)
    try:
        client.write("edit-1", grown, live_note.generation)
        await client.receipt()
        client.send(bytes([MESSAGE_SEED_CAPABILITY, 1]))
        grant, _ = await client.until(MESSAGE_FRAGMENT_SEEDER, lambda payload: payload[1] == 1)
        token, _ = read_var_string(grant, 2)
        proposal = fragment_edit(live_note.base, grown, text=source, claim="client")
        client.send(seed_proposal(live_note.generation, "seed-1", token, source, proposal))
        ack, _ = await client.until(MESSAGE_ACK)
        row = await stored(live_note.key)
        assert parse_ack_message(ack) == "seed-1"
        assert source in fragment_of(row.updates)
        assert text_of(row.updates) == source
        assert row.checkpoint_seq == 1
    finally:
        await client.leave()


async def test_replicas_converge_through_pubsub_and_repair_missed_hints(
    live_note: BufferedDocument,
) -> None:
    generation = live_note.generation
    async with routed(live_note.buffer, 2) as (left, right):
        right_router = right.realtime_router
        author, author_frames = await attach(left, live_note)
        reader, reader_frames = await attach(right, live_note)
        try:
            state = session_state(reader_frames)
            assert session_state(author_frames) == state
            await subscribed(author, state)
            await subscribed(reader, state)
            before = await stored(live_note.key)

            one = typed(live_note.base, suffix=" one")
            author.write("edit-1", one, generation)
            await author.receipt()
            await reader.text("base one")
            assert resident_text(right, live_note.key) == "base one"

            # A hint the reader's replica never sees leaves a gap the next hint exposes.
            await right_router.stop()
            two = typed(live_note.base, one, suffix=" two")
            author.write("edit-2", two, generation)
            await author.receipt()
            await right_router.start()
            await subscribed(reader, state)
            three = typed(live_note.base, one, two, suffix=" three")
            author.write("edit-3", three, generation)
            await author.receipt()
            await reader.text("base one two three")

            # With every hint withheld and the author gone, the periodic resync repairs.
            await right_router.stop()
            four = typed(live_note.base, one, two, three, suffix=" four")
            author.write("edit-4", four, generation)
            assert (await author.receipt()).accepted_sequence == 4
            await author.leave()
            reader.sync()
            frame, _ = await reader.until(MESSAGE_SESSION_STATE)
            assert parse_session_state_message(frame).head_sequence == 4
            await reader.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
            assert str(markdown_text(reader.doc)) == "base one two three four"
            assert resident_text(right, live_note.key) == "base one two three four"
            after = await stored(live_note.key)
            assert (after.revision, after.updates) == (before.revision, before.updates)
        finally:
            if not author.task.done():
                await author.leave()
            await reader.leave()
            await evicted(left, live_note.key)
            await evicted(right, live_note.key)


async def test_eviction_with_pending_tail_keeps_scheduled_work_without_snapshot_write(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    before = await stored(live_note.key)
    client, _ = await attach(manager, live_note)
    client.write("edit-1", typed(live_note.base, suffix=" pending"), live_note.generation)
    await client.receipt()
    await client.leave()
    await evicted(manager, live_note.key)

    after = await stored(live_note.key)
    assert (after.revision, after.updates, after.checkpoint_seq) == (
        before.revision,
        before.updates,
        before.checkpoint_seq,
    )
    assert await live_note.stream_ids() == [b"1-0"]
    assert await valkey().zscore(live_note.keys.due, live_note.head.scope.member) is not None


async def test_awareness_carries_the_authenticated_identity_and_refuses_peer_removal(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    sender, _ = await attach(manager, live_note)
    peer, _ = await attach(manager, live_note)
    try:
        sender.send(awareness(10, {"user": {"id": str(generate_id()), "name": "Forged"}, "x": 3}))
        frame, _ = await peer.until(YMessageType.AWARENESS)
        state = awareness_state(frame)
        assert state["user"] == {
            "id": str(live_note.owner),
            "name": "Member Tester",
            "hasAvatar": False,
        }
        assert state["x"] == 3
        sender.send(awareness(11, None))
        sender.send(awareness(10, {"x": 4}))
        frame, _ = await peer.until(YMessageType.AWARENESS)
        assert awareness_state(frame)["x"] == 4
    finally:
        await peer.leave()
        await sender.leave()


async def test_awareness_query_reaches_peers_but_not_its_sender(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    asker, _ = await attach(manager, live_note)
    peer, _ = await attach(manager, live_note)
    query = bytes([MSG_QUERY_AWARENESS])
    try:
        asker.send(query)
        frame, _ = await peer.until(MSG_QUERY_AWARENESS)
        assert frame == query
        assert MSG_QUERY_AWARENESS not in kinds(await asker.drain())
    finally:
        await peer.leave()
        await asker.leave()


class _AuthorizationOutage:
    """The registered note adapter, except that every authorization read fails."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.content_type = inner.content_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def authorize(self, *args: Any, **kwargs: Any) -> None:
        raise OSError("database unavailable")


async def test_authorization_outage_closes_for_retry_instead_of_denying(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    adapter = get_realtime_adapter(ContentType.NOTE)
    register_realtime_adapter(_AuthorizationOutage(adapter))
    try:
        client.send(bytes([3]))
        await asyncio.wait_for(client.task, FRAME_TIMEOUT)
    finally:
        register_realtime_adapter(adapter)
    assert client.socket.closes == [(1011, "session ended")]
    assert Y_MESSAGE_AUTH not in kinds(await client.drain())


async def advertise(client: Client, capable: bool) -> list[bytes]:
    """Send the seed capability, then a sync as a barrier; frames received before its reply."""
    client.send(bytes([MESSAGE_SEED_CAPABILITY, int(capable)]))
    client.sync()
    _, frames = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    return frames


def seeder_frames(frames: list[bytes]) -> list[int]:
    return [frame[1] for frame in frames if frame[0] == MESSAGE_FRAGMENT_SEEDER]


async def test_seed_role_goes_to_one_capable_client_once(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    first, _ = await attach(manager, live_note)
    second, _ = await attach(manager, live_note)
    try:
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        assert seeder_frames(await first.drain()) == []
    finally:
        await second.leave()
        await first.leave()


async def test_live_lease_on_another_replica_keeps_local_clients_waiting(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(RealtimeYjsSnapshot.content_id == live_note.key[1])
            .values(seed_owner="other:1", seed_expires_at=datetime.now(UTC) + timedelta(minutes=1))
        )
        await db.commit()
    client, _ = await attach(manager, live_note)
    try:
        assert seeder_frames(await advertise(client, capable=True)) == []
        assert (await stored(live_note.key)).seed_owner == "other:1"
    finally:
        await client.leave()


async def test_plain_clients_never_claim_the_seed_lease(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    try:
        client.write("edit-1", typed(live_note.base, suffix=" plain"), live_note.generation)
        await client.receipt()
        assert seeder_frames(await client.drain()) == []
        assert (await stored(live_note.key)).seed_owner is None
    finally:
        await client.leave()


async def test_withdrawn_capability_hands_the_seed_role_over(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    first, _ = await attach(manager, live_note)
    second, _ = await attach(manager, live_note)
    try:
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        assert seeder_frames(await advertise(first, capable=False)) == [0]
        grant, _ = await second.until(MESSAGE_FRAGMENT_SEEDER)
        assert grant[1] == 1
    finally:
        await second.leave()
        await first.leave()


async def test_expired_seed_lease_moves_without_client_traffic(
    live_note: BufferedDocument, manager: YDocManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(storage, "SEED_LEASE", timedelta(seconds=1))
    first, _ = await attach(manager, live_note)
    second, _ = await attach(manager, live_note)
    try:
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        grant, _ = await second.until(MESSAGE_FRAGMENT_SEEDER)
        revoke, _ = await first.until(MESSAGE_FRAGMENT_SEEDER)
        assert (grant[1], revoke[1]) == (1, 0)
    finally:
        await second.leave()
        await first.leave()


async def test_unverifiable_seed_election_does_not_block_release(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    client, _ = await attach(manager, live_note)
    assert seeder_frames(await advertise(client, capable=True)) == [1]
    async with buffering_disabled():
        await client.leave()
        await evicted(manager, live_note.key)
    assert client.task.exception() is None


def upgrade_socket(token: str) -> Socket:
    return Socket({"sec-websocket-protocol": f"{CANONICAL_SUBPROTOCOL}, bearer.{quote(token)}"})


@pytest.fixture
def one_socket_per_user(monkeypatch: pytest.MonkeyPatch) -> dict[UUID, int]:
    sockets: dict[UUID, int] = {}
    monkeypatch.setattr(ws_routes, "MAX_SOCKETS_PER_USER", 1)
    monkeypatch.setattr(ws_routes, "_active_sockets", sockets)
    return sockets


async def test_overlapping_upgrades_cannot_claim_the_same_slot(
    access: Any, one_socket_per_user: dict[UUID, int]
) -> None:
    token = create_access_token(access.member_id, access.org_id, token_version=1)
    first, second = upgrade_socket(token), upgrade_socket(token)
    first.hold_accept = asyncio.Event()
    pending = asyncio.create_task(ws_routes.realtime(first, access.org_id))
    try:
        await asyncio.wait_for(first.accepting.wait(), FRAME_TIMEOUT)
        await ws_routes.realtime(second, access.org_id)
        assert second.subprotocols == []
        assert second.closes == [(1013, "too many connections")]
        assert one_socket_per_user == {access.member_id: 1}
    finally:
        first.hold_accept.set()
        first.hang_up()
        await pending
    assert first.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert one_socket_per_user == {}


async def test_full_user_does_not_block_another_user(
    access: Any, one_socket_per_user: dict[UUID, int]
) -> None:
    one_socket_per_user[access.peer_id] = 1
    socket = upgrade_socket(create_access_token(access.member_id, access.org_id, token_version=1))
    socket.hang_up()
    await ws_routes.realtime(socket, access.org_id)
    assert socket.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert one_socket_per_user == {access.peer_id: 1}


@pytest.mark.parametrize("phase", ["accept_fails", "accept_cancelled", "session_cancelled"])
async def test_failed_or_cancelled_upgrades_release_their_slot(
    access: Any, one_socket_per_user: dict[UUID, int], phase: str
) -> None:
    token = create_access_token(access.member_id, access.org_id, token_version=1)
    socket = upgrade_socket(token)
    if phase == "accept_fails":
        socket.accept_error = RuntimeError("handshake failed")
    else:
        socket.hold_accept = asyncio.Event()
        if phase == "session_cancelled":
            socket.hold_accept.set()
    pending = asyncio.create_task(ws_routes.realtime(socket, access.org_id))
    await asyncio.wait_for(socket.accepting.wait(), FRAME_TIMEOUT)
    if phase == "accept_fails":
        with pytest.raises(RuntimeError):
            await pending
    else:
        await asyncio.sleep(0.05)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
    assert one_socket_per_user == {}
    replacement = upgrade_socket(token)
    replacement.hang_up()
    await ws_routes.realtime(replacement, access.org_id)
    assert replacement.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert one_socket_per_user == {}


@pytest.mark.parametrize(
    ("protocols", "selected"),
    [("uniffy.realtime.v1", "uniffy.realtime.v1"), (None, None)],
)
async def test_authenticated_upgrade_without_v2_is_closed_with_upgrade_required(
    access: Any,
    one_socket_per_user: dict[UUID, int],
    protocols: str | None,
    selected: str | None,
) -> None:
    token = create_access_token(access.member_id, access.org_id, token_version=1)
    headers = {"authorization": f"Bearer {token}"}
    if protocols is not None:
        headers["sec-websocket-protocol"] = protocols
    socket = Socket(headers)

    await ws_routes.realtime(socket, access.org_id)

    # The handshake selects a protocol the client offered so a browser receives the code.
    assert socket.subprotocols == [selected]
    assert socket.closes == [(WS_CLOSE_UPGRADE_REQUIRED, "upgrade required")]
    assert one_socket_per_user == {}


async def test_unauthenticated_upgrade_without_v2_gets_no_handshake(access: Any) -> None:
    socket = Socket({"sec-websocket-protocol": "uniffy.realtime.v1, bearer.not-a-token"})

    await ws_routes.realtime(socket, access.org_id)

    assert socket.subprotocols == []
    assert socket.closes == [(WS_CLOSE_UNAUTHENTICATED, "invalid token")]
