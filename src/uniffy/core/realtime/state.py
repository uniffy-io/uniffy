"""Shared dataclasses for the realtime stack. Kept in its own module to break import cycles."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from uuid import UUID

import pycrdt
from fastapi import WebSocket

from uniffy.core.types import ContentType

DocKey = tuple[ContentType, UUID]

# Slow consumers drop frames once full; y-protocols state-vector resync (30s)
# recovers update frames, awareness is inherently ephemeral.
OUTBOUND_QUEUE_MAX = 1024


def _new_outbound_queue() -> asyncio.Queue[bytes]:
    return asyncio.Queue(maxsize=OUTBOUND_QUEUE_MAX)


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
    except (KeyError, ValueError):
        return None


@dataclass
class WSSession:
    """One WebSocket; owns the outbound queue and per-doc handles.

    Auth binds at the WS level via the subprotocol JWT; per-doc role resolution
    happens lazily on the first frame for each new docname. ``session_id`` is
    the access-token ``sid`` claim, used by the router to close a single
    revoked session without disturbing the user's other live tokens.
    ``expires_at`` is the token's ``exp``, which bounds how long this socket may
    live - a socket that outlives its token turns a stolen access token into an
    unbounded channel.
    """

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
    closed: bool = False


@dataclass
class ClientHandle:
    """One WS's attachment to a single shared ``YDocSession``.

    ``can_edit`` lives on the handle so perm changes can flip it in place. The
    router keys handles by ``(doc_key, conn_id)`` for fanout, by ``user_id``
    for token-revoke, and by ``session_id`` for per-session revoke.
    """

    conn_id: int
    user_id: UUID
    can_edit: bool
    token_version: int | None
    ws: WebSocket
    session_id: UUID | None = None
    # ``doc_key`` / ``ws_session`` are ``None`` only in tests that exercise
    # gate logic without a real doc.
    doc_key: DocKey | None = None
    ws_session: WSSession | None = None
    closed: bool = False


@dataclass
class YDocSession:
    """Process-wide shared state for one content item under realtime edit."""

    key: DocKey
    ydoc: pycrdt.Doc
    organization_id: UUID
    clients: dict[int, ClientHandle] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    eviction_task: asyncio.Task[None] | None = None
