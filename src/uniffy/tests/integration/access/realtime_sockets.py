"""In-process sockets that play the client end of the realtime protocol against resident replicas."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from urllib.parse import quote
from uuid import UUID

import pycrdt
from fastapi import WebSocketDisconnect

from uniffy.core.auth.tokens import create_access_token
from uniffy.core.realtime.auth import CANONICAL_SUBPROTOCOL
from uniffy.core.realtime.buffer import UpdateBuffer
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
from uniffy.core.realtime.session import run_multiplexed_session
from uniffy.core.realtime.state import DocKey, WSSession, doc_name_for
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_SEED_UPDATE,
    MESSAGE_SESSION_STATE,
    MESSAGE_UPDATE,
    AcceptedReceipt,
    SessionState,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
    parse_accepted_receipt_message,
    parse_session_state_message,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import generate_id
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.realtime_live import BufferedDocument

FRAME_TIMEOUT = 5.0
QUIET_SECONDS = 0.3


class Socket:
    """An in-process WebSocket; the test plays the client end."""

    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = (
            {"sec-websocket-protocol": CANONICAL_SUBPROTOCOL} if headers is None else headers
        )
        self.subprotocols: list[str | None] = []
        self.closes: list[tuple[int, str | None]] = []
        self.hold_accept: asyncio.Event | None = None
        self.hold_send: asyncio.Event | None = None
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
        if self.hold_send is not None:
            await self.hold_send.wait()
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
            bytes([MESSAGE_UPDATE])
            + write_var_string(generation)
            + write_var_string(update_id)
            + write_var_uint(len(update))
            + update
        )

    def write_own(self, update_id: str, update: bytes, generation: str) -> None:
        """Send an edit the way an editor does: it is already in the client's own document."""
        self.doc.apply_update(update)
        self.write(update_id, update, generation)

    @property
    def markdown(self) -> str:
        return str(markdown_text(self.doc))

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
            while self.markdown != expected:
                await self.receive()

    async def holding(self, *words: str) -> str:
        """The client's text once every word has reached it."""
        async with asyncio.timeout(FRAME_TIMEOUT):
            while not all(word in self.markdown for word in words):
                await self.receive()
        return self.markdown

    async def leave(self) -> None:
        self.socket.hang_up()
        await self.task


def kinds(frames: list[bytes]) -> list[int]:
    return [frame[0] for frame in frames]


def step(sub_type: int) -> Callable[[bytes], bool]:
    return lambda payload: payload[1] == sub_type


def denial(payload: bytes) -> tuple[int, str]:
    scope, offset = read_var_uint(payload, 1)
    reason, _ = read_var_string(payload, offset)
    return scope, reason


def session_state(frames: list[bytes]) -> SessionState:
    return parse_session_state_message(next(f for f in frames if f[0] == MESSAGE_SESSION_STATE))


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


def upgrade_socket(token: str) -> Socket:
    return Socket({"sec-websocket-protocol": f"{CANONICAL_SUBPROTOCOL}, bearer.{quote(token)}"})


def bearer(user: UUID, organization: UUID) -> str:
    return create_access_token(user, organization, token_version=1)


def resident_text(manager: YDocManager, key: DocKey) -> str:
    session = manager.resident(key)
    assert session is not None
    return str(markdown_text(session.ydoc))


def connect(
    manager: YDocManager,
    key: DocKey,
    organization: UUID,
    user: UUID,
    *,
    token_version: int | None = 1,
    socket: Socket | None = None,
) -> Client:
    """A socket that has not attached ``key`` yet; its first frame for it attaches."""
    socket = socket or Socket()
    session = WSSession(
        user_id=user,
        organization_id=organization,
        token_version=token_version,
        conn_id=id(socket),
        ws=socket,
    )
    task = asyncio.create_task(run_multiplexed_session(socket, session, manager))
    return Client(socket, task, key)


async def attach(
    manager: YDocManager, document: BufferedDocument, user: UUID | None = None
) -> tuple[Client, list[bytes]]:
    """Open a socket and attach the document; returns every frame before the sync reply."""
    client = connect(manager, document.key, document.org, user or document.owner)
    client.sync()
    _, frames = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    return client, frames


@contextlib.asynccontextmanager
async def attached(
    manager: YDocManager, document: BufferedDocument, user: UUID | None = None
) -> AsyncIterator[tuple[Client, list[bytes]]]:
    """An attached client that leaves when the block ends."""
    client, frames = await attach(manager, document, user)
    try:
        yield client, frames
    finally:
        await client.leave()


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


@contextlib.asynccontextmanager
async def routed(document: BufferedDocument, count: int) -> AsyncIterator[list[YDocManager]]:
    """Replicas in this process whose routers subscribe to real Valkey pubsub.

    On exit every replica has evicted the document its clients left.
    """
    await init_pubsub()
    replicas: list[YDocManager] = []
    try:
        for _ in range(count):
            replicas.append(replica(document.buffer))
            replicas[-1].realtime_router.register_callbacks(replicas[-1].router_callbacks())
            await replicas[-1].realtime_router.start()
        yield replicas
        for each in replicas:
            await evicted(each, document.key)
    finally:
        for each in replicas:
            await each.realtime_router.stop()
            await each.drain_for_shutdown()
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
