"""Seeded note checkpoints and buffer epochs in a disposable namespace, for the buffer suites."""

import asyncio
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pycrdt
import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from prometheus_client import REGISTRY
from sqlalchemy import delete, update

from uniffy.core.jobs import JobEnqueueOutcome, JobRef
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import RecoveryReason, UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    AdmissionOutcome,
    AdmissionStatus,
    BufferHead,
    LatestState,
    Receipt,
    bucket_for,
    buffer_keys,
    stored_bytes,
)
from uniffy.core.realtime.checkpoint import stage_recovered
from uniffy.core.realtime.dispatch import run_checkpoint_job
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.job_contracts import CHECKPOINT_REALTIME_DOCUMENT
from uniffy.core.realtime.maintenance import maintain_buffer
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD, markdown_text
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.core.types import ContentType
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import close_binary_client, init_binary_client
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.tests.integration.access.realtime_live import BUDGET, Recorder, valkey
from uniffy.tests.integration.access.recording_search import recording_indexer

STALE_RUN_ID = "0" * 40
# Every due window has passed at this instant.
FAR_FUTURE_MS = 2**52
RUN_ID_FIELD = re.compile(rb"run_id:[0-9a-f]{40}")
# The value bulk string after the name in a CONFIG GET maxmemory-policy reply.
POLICY_REPLY = re.compile(rb"(\$16\r\nmaxmemory-policy\r\n)\$\d+\r\n[a-z-]+\r\n")


def edit(base: bytes, suffix: str) -> bytes:
    """A client edit appending ``suffix`` to the text of ``base``."""
    doc = pycrdt.Doc()
    doc.apply_update(base)
    before = doc.get_state()
    text = markdown_text(doc)
    text.insert(len(str(text)), suffix)
    return doc.get_update(before)


async def seed_checkpoint(key: DocKey, organization_id: UUID) -> bytes:
    doc = pycrdt.Doc()
    doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = str(uuid4())
    markdown_text(doc).insert(0, "base")
    async with open_session() as db:
        db.add(
            RealtimeYjsSnapshot(
                content_type=key[0],
                content_id=key[1],
                organization_id=organization_id,
                generation=doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY],
                updates=doc.get_update(),
                state_vector=doc.get_state(),
            )
        )
        await db.commit()
    return doc.get_update()


async def _discard_rows(keys: list[DocKey]) -> None:
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_id.in_([key[1] for key in keys])
            )
        )
        await db.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def env(access, valkey_namespace) -> AsyncIterator[SimpleNamespace]:
    """Checkpoints for three of the access fixture's notes and a buffer in a fresh namespace."""
    register_realtime_adapter(NoteRealtimeAdapter(recording_indexer()))
    keys = [
        (ContentType.NOTE, note_id)
        for note_id in (access.private_note_id, access.shared_note_id, access.org_note_id)
    ]
    bases = [await seed_checkpoint(key, access.org_id) for key in keys]
    try:
        yield SimpleNamespace(
            buffer=UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET),
            namespace=valkey_namespace,
            key=keys[0],
            keys=keys,
            base=bases[0],
            bases=bases,
            org=access.org_id,
            actor=access.member_id,
            alice=access.member_id,
            bob=access.peer_id,
            carol=access.owner_id,
            jobs=Recorder(),
        )
    finally:
        await _discard_rows(keys)


@pytest_asyncio.fixture(loop_scope="session")
async def bucket_mates(env) -> AsyncIterator[Callable[..., Awaitable[list[DocKey]]]]:
    """Seeds extra documents that hash into one buffer bucket; teardown deletes their rows.

    Documents belong to the environment's organization unless the caller names another.
    """
    created: list[DocKey] = []

    async def seed(bucket: int, count: int, organization: UUID | None = None) -> list[DocKey]:
        organization = organization or env.org
        keys: list[DocKey] = []
        while len(keys) < count:
            key = (ContentType.NOTE, uuid4())
            if bucket_for(organization, key[0], key[1]) == bucket:
                await seed_checkpoint(key, organization)
                created.append(key)
                keys.append(key)
        return keys

    try:
        yield seed
    finally:
        await _discard_rows(created)


async def establish(
    env: SimpleNamespace,
    key: DocKey | None = None,
    *,
    stage: Any = stage_recovered,
    reset: RecoveryReason | None = None,
    organization: UUID | None = None,
) -> BufferHead:
    key = key or env.key
    organization = organization or env.org
    async with open_session() as db:
        await lock_document(db, key, organization)
        head = await ensure_epoch(
            env.buffer, db, key, organization, stage_recovered=stage, reset=reset
        )
        await db.commit()
    return head


def stored_cost(entries: list[tuple[bytes, dict[bytes, bytes]]]) -> int:
    """What stream entries count against the document limit and the pending budget."""
    return sum(stored_bytes(fields[b"i"].decode(), fields[b"u"]) for _, fields in entries)


async def offer(
    env: SimpleNamespace,
    head: BufferHead,
    update_id: str,
    payload: bytes,
    *,
    actor: UUID | None = None,
    buffer: UpdateBuffer | None = None,
) -> AdmissionOutcome:
    """Whatever the buffer answers for one append."""
    return await (buffer or env.buffer).admit(
        head, update_id=update_id, update=payload, actor_id=actor or env.actor
    )


async def admit(
    env: SimpleNamespace,
    head: BufferHead,
    update_id: str,
    payload: bytes,
    *,
    actor: UUID | None = None,
    buffer: UpdateBuffer | None = None,
) -> AdmissionOutcome:
    """An append the buffer must accept."""
    outcome = await offer(env, head, update_id, payload, actor=actor, buffer=buffer)
    assert outcome.status is AdmissionStatus.ACCEPTED
    return outcome


async def latest(env: SimpleNamespace, key: DocKey | None = None) -> LatestState | None:
    async with open_session() as db:
        return await env.buffer.load_latest(db, key or env.key)


async def stored_row(key: DocKey) -> RealtimeYjsSnapshot:
    async with open_session() as db:
        row = await load_snapshot(db, key)
    assert row is not None
    return row


async def set_row(key: DocKey, **values: Any) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
            .values(**values)
        )
        await db.commit()


async def stream_ids(head: BufferHead, namespace: str) -> list[bytes]:
    return [
        entry_id for entry_id, _ in await valkey().xrange(buffer_keys(head.scope, namespace).stream)
    ]


def receipt(head: BufferHead, seq: int, update_id: str) -> Receipt:
    return Receipt(head.scope.generation, head.scope.epoch, seq, update_id)


def gauge(name: str, labels: dict[str, str] | None = None) -> float:
    return REGISTRY.get_sample_value(name, labels or {}) or 0.0


async def maintenance_cycle(buffer: UpdateBuffer, now_ms: int | None = None) -> dict:
    """Action counts of one complete maintenance walk of the key space."""
    totals: dict = {}
    for _ in range(100):
        report = await maintain_buffer(buffer, now_ms=now_ms)
        for action, count in report.actions.items():
            totals[action] = totals.get(action, 0) + count
        if report.cycle_complete:
            return totals
    raise AssertionError("buffer maintenance never completed a walk of the key space")


class Inline:
    """Runs each dispatched checkpoint right away, the way a core worker picks it up."""

    def __init__(self, buffer: UpdateBuffer) -> None:
        self.buffer = buffer
        self.projections = Recorder()
        self.results: list[Any] = []

    async def __call__(self, ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
        if ref is CHECKPOINT_REALTIME_DOCUMENT:
            member, claim = args
            self.results.append(
                await run_checkpoint_job(self.buffer, member, claim, enqueue=self.projections)
            )
        return JobEnqueueOutcome.ENQUEUED


class ValkeyRelay:
    """TCP relay to Valkey that can swallow replies or pose as a restarted server.

    ``policy`` makes the relay report that eviction policy for CONFIG GET maxmemory-policy.
    """

    def __init__(self) -> None:
        config = ValkeyConfig.from_env()
        self._upstream = (config.host, config.port)
        self.dropping = False
        self.policy: str | None = None
        self._run_id: bytes | None = None
        self._server: asyncio.Server | None = None
        self._writers: list[asyncio.StreamWriter] = []

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._relay, "127.0.0.1", 0)
        return self._server.sockets[0].getsockname()[1]

    async def close(self) -> None:
        await self._drop_connections()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def restart(self, run_id: str) -> None:
        """Open connections drop and later ones report ``run_id``, as after a server restart."""
        self._run_id = run_id.encode()
        await self._drop_connections()
        # Lets every client socket read its end of stream before the next command.
        await asyncio.sleep(0.05)

    async def _drop_connections(self) -> None:
        writers, self._writers = self._writers, []
        for writer in writers:
            writer.close()
        await asyncio.gather(*(writer.wait_closed() for writer in writers), return_exceptions=True)

    async def _relay(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        upstream_reader, upstream_writer = await asyncio.open_connection(*self._upstream)
        self._writers += [writer, upstream_writer]
        await asyncio.gather(
            self._pipe(reader, upstream_writer, replies=False),
            self._pipe(upstream_reader, writer, replies=True),
            return_exceptions=True,
        )

    async def _pipe(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, replies: bool
    ) -> None:
        try:
            while data := await reader.read(65536):
                if replies and self._run_id is not None:
                    # Same length, so the reply's bulk string header stays valid.
                    data = RUN_ID_FIELD.sub(b"run_id:" + self._run_id, data)
                if replies and self.policy is not None:
                    data = POLICY_REPLY.sub(
                        rb"\1$%d\r\n%s\r\n" % (len(self.policy), self.policy.encode()), data
                    )
                if not (replies and self.dropping):
                    writer.write(data)
                    await writer.drain()
        finally:
            writer.close()


@pytest_asyncio.fixture(loop_scope="session")
async def proxied() -> AsyncIterator[tuple[ValkeyRelay, aioredis.Redis]]:
    """A client of its own that reaches Valkey through a relay."""
    proxy = ValkeyRelay()
    port = await proxy.start()
    config = ValkeyConfig.from_env()
    client = aioredis.Redis(
        host="127.0.0.1",
        port=port,
        password=config.password,
        db=config.database,
        **config.to_binary_kwargs(),
    )
    try:
        yield proxy, client
    finally:
        await client.aclose()
        await proxy.close()


@pytest_asyncio.fixture(loop_scope="session")
async def relayed(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[ValkeyRelay]:
    """The process binary client reaches Valkey through a relay for the length of one test."""
    relay = ValkeyRelay()
    port = await relay.start()
    await close_binary_client()
    monkeypatch.setenv("VALKEY_HOST", "127.0.0.1")
    monkeypatch.setenv("VALKEY_PORT", str(port))
    try:
        await init_binary_client()
        yield relay
    finally:
        await close_binary_client()
        monkeypatch.undo()
        await init_binary_client()
        await relay.close()
