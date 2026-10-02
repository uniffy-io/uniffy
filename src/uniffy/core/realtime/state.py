"""Shared realtime state keeps transport and persistence dependencies acyclic."""

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
    closed: bool = False


@dataclass
class ClientHandle:
    """Document attachment carries live edit permission for one socket."""

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
    policy_key: DocKey | None = None
    # Snapshots carry no request actor; the last live editor attributes their side effects.
    last_editor_id: UUID | None = None
    seeder_conn_id: int | None = None
    clients: dict[int, ClientHandle] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    eviction_task: asyncio.Task[None] | None = None
