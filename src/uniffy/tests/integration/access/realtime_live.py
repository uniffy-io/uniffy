"""Seeded documents with a live buffer epoch, for tests of the barriers that commit live state."""

import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import pycrdt
import pytest_asyncio
import valkey.asyncio as aioredis
from sqlalchemy import delete

from uniffy.core.jobs import JobEnqueueOutcome, JobRef
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.admission import Admitted, admit_update
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import AdmissionStatus, BufferHead, BufferKeys, buffer_keys
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document, stage_recovered
from uniffy.core.realtime.epoch import ensure_epoch, row_scope
from uniffy.core.realtime.markdown import (
    MARKDOWN_MIRROR_FIELD,
    PROSEMIRROR_FRAGMENT_FIELD,
    markdown_text,
)
from uniffy.core.realtime.preflight import PreflightMode, run_preflight
from uniffy.core.realtime.publisher import RealtimePayloadKind, doc_channel
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.realtime.storage import load_snapshot, lock_document, stage_seed
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import get_binary_client
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.recording_search import recording_indexer

BUDGET = 1024 * 1024 * 1024
# Nothing listens here, so every call fails the way an unreachable Valkey does.
UNREACHABLE_VALKEY = "redis://127.0.0.1:1/0"


class Recorder:
    """Stands in for the core queue; recorded jobs never run."""

    def __init__(self) -> None:
        self.jobs: list[tuple[str, str, tuple[str, ...]]] = []

    async def __call__(self, ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
        self.jobs.append((ref.name, job_id, args))
        return JobEnqueueOutcome.ENQUEUED


def valkey() -> aioredis.Redis:
    client = get_binary_client()
    assert client is not None
    return client


def document(*updates: bytes) -> pycrdt.Doc:
    doc = pycrdt.Doc()
    for update in updates:
        doc.apply_update(update)
    return doc


def text_of(*updates: bytes) -> str:
    return str(markdown_text(document(*updates)))


def fragment_of(*updates: bytes) -> str:
    return str(document(*updates).get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment))


def typed(*history: bytes, suffix: str) -> bytes:
    """A client edit appending ``suffix`` after everything it has seen."""
    doc = document(*history)
    before = doc.get_state()
    text = markdown_text(doc)
    text.insert(len(str(text)), suffix)
    return doc.get_update(before)


def fragment_edit(*history: bytes, text: str, claim: str | None = None) -> bytes:
    """A rich editor writing one paragraph, optionally claiming the fragment seed."""
    doc = document(*history)
    before = doc.get_state()
    doc[PROSEMIRROR_FRAGMENT_FIELD] = pycrdt.XmlFragment([
        pycrdt.XmlElement("paragraph", contents=[pycrdt.XmlText(text)])
    ])
    if claim is not None:
        doc.get(MARKDOWN_MIRROR_FIELD, type=pycrdt.Map)[f"seeded_by:{claim}"] = [0]
    return doc.get_update(before)


async def stored(key: DocKey) -> RealtimeYjsSnapshot:
    async with open_session() as db:
        row = await load_snapshot(db, key)
    assert row is not None
    return row


@dataclass
class BufferedDocument:
    """A seeded note, task or event description bound to a buffer epoch in a test namespace."""

    key: DocKey
    org: UUID
    owner: UUID
    peer: UUID
    namespace: str
    buffer: UpdateBuffer
    base: bytes
    generation: str
    head: BufferHead
    jobs: Recorder = field(default_factory=Recorder)

    @property
    def keys(self) -> BufferKeys:
        return buffer_keys(self.head.scope, self.namespace)

    async def admit(self, update_id: str, update: bytes, actor: UUID | None = None) -> int:
        outcome = await self.buffer.admit(
            self.head, update_id=update_id, update=update, actor_id=actor or self.owner
        )
        assert outcome.status is AdmissionStatus.ACCEPTED
        assert outcome.receipt is not None
        return outcome.receipt.seq

    async def admit_live(self, update_id: str, update: bytes, actor: UUID | None = None) -> Admitted:
        """Admit ``update`` the way a live socket does: fresh PostgreSQL checks, then the buffer."""
        session = YDocSession(key=self.key, ydoc=pycrdt.Doc(), organization_id=self.org)
        return await admit_update(
            self.buffer,
            session,
            actor or self.owner,
            self.generation,
            update_id,
            update,
            lambda *_: None,
        )

    async def checkpointed(self) -> RealtimeYjsSnapshot:
        """Let the checkpoint worker commit the buffered tail; projection stays pending."""
        scope = row_scope(await stored(self.key))
        result = await checkpoint_document(self.buffer, scope, enqueue=self.jobs)
        assert result.status is CheckpointStatus.COMMITTED
        return await stored(self.key)

    async def stream_ids(self) -> list[bytes]:
        return [entry_id for entry_id, _ in await valkey().xrange(self.keys.stream)]

    async def buffer_state(self) -> dict[str, Any]:
        """Everything the epoch keeps in Valkey for this document."""
        keys = self.keys
        return {
            "stream": await self.stream_ids(),
            "control": await valkey().exists(keys.control),
            "receipts": sorted(await valkey().hkeys(keys.receipts)),
            "due": await valkey().zscore(keys.due, self.head.scope.member),
        }


async def establish(buffer: UpdateBuffer, key: DocKey, organization_id: UUID) -> BufferHead:
    async with open_session() as db:
        await lock_document(db, key, organization_id)
        head = await ensure_epoch(buffer, db, key, organization_id, stage_recovered=stage_recovered)
        await db.commit()
    return head


async def buffered(key: DocKey, access: Any, namespace: str) -> BufferedDocument:
    """Seed ``key`` for the access fixture's member and bind it to a fresh epoch in ``namespace``."""
    async with open_session() as db:
        await lock_document(db, key, access.org_id)
        row = await stage_seed(db, key, access.org_id)
        await db.commit()
        base, generation = row.updates, row.generation
    assert generation is not None
    buffer = UpdateBuffer(namespace=namespace, pending_budget_bytes=BUDGET)
    return BufferedDocument(
        key=key,
        org=access.org_id,
        owner=access.member_id,
        peer=access.peer_id,
        namespace=namespace,
        buffer=buffer,
        base=base,
        generation=generation,
        head=await establish(buffer, key, access.org_id),
    )


@pytest_asyncio.fixture(loop_scope="session")
async def live_note(access, valkey_namespace) -> AsyncIterator[BufferedDocument]:
    """A member's note whose snapshot row is seeded and bound to a fresh buffer epoch."""
    register_realtime_adapter(NoteRealtimeAdapter(recording_indexer()))
    async with open_session() as db:
        note = Note(
            organization_id=access.org_id,
            owner_id=access.member_id,
            title="Live",
            slug=f"live-{generate_id().hex}",
            content="base",
        )
        db.add(note)
        await db.commit()
        key = (ContentType.NOTE, note.id)
    try:
        yield await buffered(key, access, valkey_namespace)
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
            )
            await db.execute(delete(Note).where(Note.id == key[1]))
            await db.commit()


@contextlib.asynccontextmanager
async def unreachable(namespace: str) -> AsyncIterator[UpdateBuffer]:
    """A buffer namespace reached through a client whose server is gone."""
    client = aioredis.from_url(UNREACHABLE_VALKEY, socket_connect_timeout=0.2)
    try:
        yield UpdateBuffer(namespace=namespace, pending_budget_bytes=BUDGET, client=client)
    finally:
        await client.aclose()


class _EvictingValkey:
    """A serving Valkey whose allkeys eviction policy keeps buffered acceptance disabled."""

    config = {"maxmemory-policy": "allkeys-lru", "maxmemory": "0"}

    async def info(self, section: str) -> dict[str, object]:
        if section == "server":
            return {"run_id": "0" * 40, "valkey_version": "9.1.2"}
        return {"aof_enabled": 1}

    async def config_get(self, pattern: str) -> dict[str, str]:
        return {pattern: self.config[pattern]} if pattern in self.config else {}


@contextlib.asynccontextmanager
async def buffering_disabled() -> AsyncIterator[None]:
    """Preflight refuses the buffer, so no live state can be verified until the block ends."""
    await run_preflight(_EvictingValkey(), mode=PreflightMode.STRICT)
    try:
        yield
    finally:
        await run_preflight(valkey())


@contextlib.asynccontextmanager
async def doc_subscription(key: DocKey) -> AsyncIterator[Any]:
    """Everything published on one document's channel from now on."""
    await init_pubsub()
    client = aioredis.from_url(ValkeyConfig.from_env().to_url())
    subscription = client.pubsub()
    await subscription.subscribe(doc_channel(*key))
    try:
        yield subscription
    finally:
        await subscription.aclose()
        await client.aclose()
        await close_pubsub()


@pytest_asyncio.fixture(loop_scope="session")
async def unreachable_buffer(live_note) -> AsyncIterator[UpdateBuffer]:
    async with unreachable(live_note.namespace) as buffer:
        yield buffer


@pytest_asyncio.fixture(loop_scope="session")
async def doc_messages(live_note) -> AsyncIterator[Any]:
    async with doc_subscription(live_note.key) as subscription:
        yield subscription


async def published(subscription: Any) -> list[dict[str, Any]]:
    """Payloads published on the subscribed channel so far, oldest first."""
    found: list[dict[str, Any]] = []
    for _ in range(10):
        message = await subscription.get_message(ignore_subscribe_messages=True, timeout=0.1)
        if message is not None:
            found.append(loads(message["data"]))
    return found


async def published_progress(subscription: Any) -> list[dict[str, Any]]:
    """Checkpoint progress announced on the document channel so far, oldest first."""
    return [
        {
            name: payload[name]
            for name in ("generation", "epoch", "covered_sequence", "checkpoint_revision")
        }
        for payload in await published(subscription)
        if payload.get("kind") == RealtimePayloadKind.CHECKPOINT_PROGRESS
    ]


async def replacement_hints(subscription: Any) -> int:
    """How many times the document channel told resident replicas to reload."""
    return sum(
        payload.get("kind") == RealtimePayloadKind.CONTENT_REPLACE
        for payload in await published(subscription)
    )
