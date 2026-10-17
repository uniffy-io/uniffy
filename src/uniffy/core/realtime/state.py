"""Shared realtime state keeps transport and persistence dependencies acyclic."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

import pycrdt
from fastapi import WebSocket

from uniffy.core.realtime.limits import MAX_DOCS_PER_SOCKET, RESYNC_INTERVAL_SECONDS
from uniffy.core.types import ContentType

DocKey = tuple[ContentType, UUID]

# Slow consumers drop frames once full; y-protocols state-vector resync (30s)
# recovers update frames, awareness is inherently ephemeral.
OUTBOUND_QUEUE_MAX = 1024
OUTBOUND_BYTES_MAX = 8 * 1024 * 1024


class OutboundQueue(asyncio.Queue[bytes]):
    """Bound retained bytes as well as frame count for slow sockets."""

    def __init__(
        self, maxsize: int = OUTBOUND_QUEUE_MAX, max_bytes: int = OUTBOUND_BYTES_MAX
    ) -> None:
        super().__init__(maxsize=maxsize)
        self.max_bytes = max_bytes
        self.queued_bytes = 0

    async def put(self, item: bytes) -> None:
        if len(item) > self.max_bytes:
            raise asyncio.QueueFull
        await super().put(item)

    def put_nowait(self, item: bytes) -> None:
        if self.queued_bytes + len(item) > self.max_bytes:
            raise asyncio.QueueFull
        super().put_nowait(item)
        self.queued_bytes += len(item)

    def get_nowait(self) -> bytes:
        item = super().get_nowait()
        self.queued_bytes -= len(item)
        return item


def _new_outbound_queue() -> asyncio.Queue[bytes]:
    return OutboundQueue()


@dataclass
class TokenBucket:
    """Tokens refill continuously at ``per_second`` up to ``capacity``; a fresh bucket is full."""

    capacity: float
    per_second: float
    tokens: float = field(init=False)
    checked_at: float = field(default_factory=time.monotonic)

    def __post_init__(self) -> None:
        self.tokens = self.capacity

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.checked_at) * self.per_second)
        self.checked_at = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True

    async def wait(self) -> None:
        """Take a token, sleeping until one refills."""
        while not self.take():
            await asyncio.sleep((1 - self.tokens) / self.per_second)


def _resync_budget() -> TokenBucket:
    # Clients resync every attached document once per interval, plus once on attach or app
    # foreground, so twice the document limit never makes a legitimate resync wait.
    return TokenBucket(
        capacity=2 * MAX_DOCS_PER_SOCKET,
        per_second=MAX_DOCS_PER_SOCKET / RESYNC_INTERVAL_SECONDS,
    )


def doc_name_for(key: DocKey) -> str:
    """Canonical docname (``"NOTE:<uuid>"``) for multiplex frames."""
    content_type, content_id = key
    return f"{content_type.value}:{content_id}"


def parse_doc_name(doc_name: str) -> DocKey | None:
    """Inverse of :func:`doc_name_for`; ``None`` on malformed input."""
    parts = doc_name.split(":", 1)
    if len(parts) != 2:
        return None
    try:
        return (ContentType[parts[0]], UUID(parts[1]))
    except KeyError, ValueError:
        return None


@dataclass
class WSSession:
    """Socket identity bounds every attached document by token and session lifetime."""

    user_id: UUID
    organization_id: UUID
    token_version: int | None
    conn_id: int
    ws: WebSocket
    session_id: UUID | None = None
    expires_at: float | None = None
    connected_at: float = field(default_factory=time.time)
    outbound: asyncio.Queue[bytes] = field(default_factory=_new_outbound_queue)
    doc_handles: dict[DocKey, ClientHandle] = field(default_factory=dict)
    denied_docs: set[DocKey] = field(default_factory=set)
    # Each answered resync encodes a whole document, so a flood waits instead of stalling the loop.
    resyncs: TokenBucket = field(default_factory=_resync_budget)
    closed: bool = False


@dataclass
class ClientHandle:
    """Document attachment carries live edit permission for one socket."""

    conn_id: int
    user_id: UUID
    can_edit: bool
    token_version: int | None
    ws: WebSocket
    doc_key: DocKey
    ws_session: WSSession
    can_seed: bool = False
    awareness_client_id: int | None = None
    awareness_user: dict | None = None
    # Monotonic time of the last awareness query relayed for this handle.
    awareness_queried_at: float | None = None
    session_id: UUID | None = None
    closed: bool = False


@dataclass
class YDocSession:
    """Process-wide shared state for one content item under realtime edit."""

    key: DocKey
    ydoc: pycrdt.Doc
    organization_id: UUID
    policy_key: DocKey | None = None
    seeder_conn_id: int | None = None
    seed_token: str = ""
    seed_expires_at: datetime | None = None
    seed_task: asyncio.Task[None] | None = None
    seed_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    generation: str = ""
    # The buffer epoch ``ydoc`` follows; ``None`` while the buffer could not be read.
    epoch: str | None = None
    # Highest accepted sequence of ``epoch`` already applied to ``ydoc``.
    head_seq: int = 0
    checkpoint_seq: int = 0
    checkpoint_revision: int = -1
    clients: dict[int, ClientHandle] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    eviction_task: asyncio.Task[None] | None = None
    # Validation copy of ``ydoc``. Every update ``ydoc`` takes reaches it too, so admission checks
    # an incoming update in time proportional to the update. ``None`` until the next check
    # rebuilds it from ``ydoc``.
    shadow: pycrdt.Doc | None = None
    # The shadow holds a checked update that ``ydoc`` has not taken yet.
    shadow_ahead: bool = False
    # Upper bound on the encoded size of ``ydoc``: exact when the shadow was built, plus every
    # update applied since.
    encoded_bound: int = 0
