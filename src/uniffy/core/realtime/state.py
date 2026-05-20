"""Shared dataclasses for the realtime stack.

One ``WSSession`` per browser WebSocket carries N ``ClientHandle``
instances, one per attached doc. Outbound frames are docname-prefixed
at enqueue time so the WS pump is a trivial drain loop and the
queue's backpressure cap protects the whole socket.

Kept in its own module so ``snapshot.py`` / ``ydoc_manager.py`` /
``router.py`` can all import without cycles.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from uuid import UUID

import pycrdt
from fastapi import WebSocket

from uniffy.core.types import ContentType

DocKey = tuple[ContentType, UUID]

# Per-WS outbound frame cap. Must absorb fanout across every doc this
# browser has attached. Slow consumers drop frames once full;
# y-protocols state-vector resync (30s tick) recovers update frames,
# awareness is inherently ephemeral.
OUTBOUND_QUEUE_MAX = 1024


def _new_outbound_queue() -> asyncio.Queue[bytes]:
    return asyncio.Queue(maxsize=OUTBOUND_QUEUE_MAX)


def doc_name_for(key: DocKey) -> str:
    """Canonical docname (``"NOTE:<uuid>"``) for multiplex frames."""
    content_type, content_id = key
    return f"{content_type.value}:{content_id}"


def parse_doc_name(doc_name: str) -> DocKey | None:
    """Inverse of :func:`doc_name_for`. ``None`` on malformed input."""
    parts = doc_name.split(":", 1)
    if len(parts) != 2:
        return None
    try:
        return (ContentType[parts[0]], UUID(parts[1]))
    except (KeyError, ValueError):
        return None


@dataclass
class WSSession:
    """One WebSocket. Owns the outbound queue and the per-doc handles.

    Authentication is bound at the WS level via the subprotocol bearer
    JWT; per-doc role resolution happens lazily on the first frame for
    each new docname.
    """

    user_id: UUID
    organization_id: UUID
    token_version: int | None
    conn_id: int
    ws: WebSocket
    outbound: asyncio.Queue[bytes] = field(default_factory=_new_outbound_queue)
    doc_handles: dict[DocKey, ClientHandle] = field(default_factory=dict)
    closed: bool = False


@dataclass
class ClientHandle:
    """One WS's attachment to a single shared ``YDocSession``.

    The router keys handles by ``(doc_key, conn_id)`` for fanout and by
    ``user_id`` for token-revoke. ``can_edit`` lives on the handle so
    perm changes can flip it in place.
    """

    conn_id: int
    user_id: UUID
    can_edit: bool
    token_version: int | None
    ws: WebSocket
    doc_key: DocKey | None = None
    """Set once attached; ``None`` only in unit tests that exercise
    gate / close logic without a real doc."""

    ws_session: WSSession | None = None
    """``None`` only in tests."""

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
