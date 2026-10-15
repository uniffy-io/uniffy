"""Realtime update buffer on live Valkey and PostgreSQL inside a disposable key namespace."""

import asyncio
import dataclasses
import hashlib
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pycrdt
import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from prometheus_client import REGISTRY
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import (
    AdmissionUnknown,
    BufferUnavailable,
    RecoveryReason,
    RecoveryRequired,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    MAX_PENDING_DOCUMENT_BYTES,
    MAX_PENDING_DOCUMENT_RECORDS,
    AdmissionOutcome,
    AdmissionStatus,
    BufferedUpdate,
    BufferHead,
    PendingUsage,
    Receipt,
    TrimResult,
    accounting_key,
    bucket_for,
    buffer_keys,
    merge_tail,
)
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD, markdown_text
from uniffy.core.realtime.preflight import run_preflight
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.core.types import ContentType
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import (
    close_binary_client,
    get_binary_client,
    init_binary_client,
    server_identity,
)
from uniffy.infrastructure.valkey.config import ValkeyConfig

pytestmark = pytest.mark.asyncio(loop_scope="session")

BUDGET = 1024 * 1024 * 1024
STALE_RUN_ID = "0" * 40
RESTARTED_RUN_IDS = ("a" * 40, "b" * 40)
RUN_ID_FIELD = re.compile(rb"run_id:[0-9a-f]{40}")


def valkey() -> aioredis.Redis:
    client = get_binary_client()
    assert client is not None
    return client


def text_of(update_bytes: bytes) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(update_bytes)
    return str(markdown_text(doc))


def edit(base: bytes, suffix: str) -> bytes:
    doc = pycrdt.Doc()
    doc.apply_update(base)
    before = doc.get_state()
    text = markdown_text(doc)
    text.insert(len(str(text)), suffix)
    return doc.get_update(before)


async def stage_merge(
    db: AsyncSession, snapshot: RealtimeYjsSnapshot, updates: tuple[BufferedUpdate, ...]
) -> None:
    snapshot.updates = merge_tail(snapshot.updates, updates)
    snapshot.state_vector = pycrdt.get_state(snapshot.updates)
    snapshot.revision += 1
    snapshot.actor_id = updates[-1].actor_id


async def seed_checkpoint(key: DocKey, organization_id) -> bytes:
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


def epoch_resets(reason: RecoveryReason) -> float:
    sample = REGISTRY.get_sample_value(
        "uniffy_realtime_buffer_epoch_resets_total", {"reason": reason.value}
    )
    return sample or 0.0


@pytest_asyncio.fixture(loop_scope="session")
async def env(access, valkey_namespace) -> AsyncIterator[SimpleNamespace]:
    register_realtime_adapter(NoteRealtimeAdapter(MagicMock()))
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
        )
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_id.in_([key[1] for key in keys])
                )
            )
            await db.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def bucket_mates(env) -> AsyncIterator[Callable[[int, int], Awaitable[list[DocKey]]]]:
    """Seeds extra documents that hash into one buffer bucket; teardown deletes their rows."""
    created: list[DocKey] = []

    async def seed(bucket: int, count: int) -> list[DocKey]:
        keys: list[DocKey] = []
        while len(keys) < count:
            key = (ContentType.NOTE, uuid4())
            if bucket_for(env.org, key[0], key[1]) == bucket:
                await seed_checkpoint(key, env.org)
                created.append(key)
                keys.append(key)
        return keys

    try:
        yield seed
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_id.in_([key[1] for key in created])
                )
            )
            await db.commit()


async def establish(
    env: SimpleNamespace,
    key: DocKey | None = None,
    *,
    stage: Any = stage_merge,
    reset: RecoveryReason | None = None,
) -> BufferHead:
    key = key or env.key
    async with open_session() as db:
        await lock_document(db, key, env.org)
        head = await ensure_epoch(env.buffer, db, key, env.org, stage_recovered=stage, reset=reset)
        await db.commit()
    return head


async def admit(
    env: SimpleNamespace, head: BufferHead, update_id: str, payload: bytes, *, buffer=None
) -> AdmissionOutcome:
    return await (buffer or env.buffer).admit(
        head, update_id=update_id, update=payload, actor_id=env.actor
    )


async def latest(env: SimpleNamespace, key: DocKey | None = None):
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


def receipt(head: BufferHead, seq: int, update_id: str) -> Receipt:
    return Receipt(head.scope.generation, head.scope.epoch, seq, update_id)


async def test_first_establishment_binds_a_fresh_epoch_to_the_serving_instance(env) -> None:
    head = await establish(env)
    row = await stored_row(env.key)
    identity = server_identity()

    assert identity is not None
    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        head.scope.epoch,
        identity.run_id,
        0,
    )
    assert head.scope.generation == row.generation
    assert (head.head_seq, head.checkpoint_seq, head.checkpoint_revision, head.run_id) == (
        0,
        0,
        row.revision,
        identity.run_id,
    )
    assert await establish(env) == head


async def test_accepted_update_stores_record_receipt_due_entry_and_counters(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice, bob = edit(env.base, " Alice"), edit(env.base, " Bob")

    first = await admit(env, head, "u-1", alice)
    control = await valkey().hgetall(keys.control)
    second = await admit(env, head, "u-2", bob)

    assert first == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 1, "u-1"))
    assert second == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 2, "u-2"))
    entries = await valkey().xrange(keys.stream)
    assert [entry_id for entry_id, _ in entries] == [b"1-0", b"2-0"]
    fields = entries[0][1]
    assert (fields[b"i"], fields[b"u"], fields[b"a"], fields[b"v"]) == (
        b"u-1",
        alice,
        str(env.actor).encode(),
        b"1",
    )
    first_pending = int(control[b"first_ms"])
    assert int(fields[b"t"]) == first_pending
    after = await valkey().hgetall(keys.control)
    assert (after[b"head"], after[b"records"], after[b"first_ms"]) == (
        b"2",
        b"2",
        control[b"first_ms"],
    )
    assert int(after[b"bytes"]) == len(alice) + len(bob)
    assert await valkey().hget(keys.receipts, "u-2") == (
        f"2:{hashlib.sha256(bob).hexdigest()}".encode()
    )
    assert await valkey().zscore(keys.due, head.scope.member) == first_pending + DUE_DELAY_MS
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(len(alice) + len(bob), 2)
    for key in (keys.stream, keys.control, keys.receipts):
        assert await valkey().ttl(key) == -1


async def test_duplicate_update_id_with_same_bytes_returns_the_existing_sequence(env) -> None:
    head = await establish(env)
    payload = edit(env.base, " once")

    first = await admit(env, head, "u-1", payload)
    again = await admit(env, head, "u-1", payload)

    assert again == AdmissionOutcome(AdmissionStatus.DUPLICATE, first.receipt)
    assert await valkey().xlen(buffer_keys(head.scope, env.namespace).stream) == 1
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(len(payload), 1)


async def test_duplicate_update_id_with_changed_bytes_is_an_id_conflict(env) -> None:
    head = await establish(env)
    original, changed = edit(env.base, " original"), edit(env.base, " changed")
    keys = buffer_keys(head.scope, env.namespace)

    await admit(env, head, "u-1", original)
    conflict = await admit(env, head, "u-1", changed)

    assert conflict == AdmissionOutcome(AdmissionStatus.ID_CONFLICT)
    assert [fields[b"u"] for _, fields in await valkey().xrange(keys.stream)] == [original]


@pytest.mark.parametrize(
    ("update_id", "payload"),
    [
        ("", b"u"),
        ("x" * (MAX_WIRE_STRING_BYTES + 1), b"u"),
        ("u-1", b""),
        ("u-1", b"u" * (MAX_FRAME_BYTES + 1)),
    ],
)
async def test_wrong_type_arguments_are_refused_before_any_write(
    env, update_id: str, payload: bytes
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcome = await admit(env, head, update_id, payload)

    assert outcome == AdmissionOutcome(AdmissionStatus.TYPE_ERROR)
    assert await valkey().exists(keys.stream, keys.receipts) == 0
    assert await valkey().hget(keys.control, "head") == b"0"


async def test_buffer_key_holding_another_type_is_a_type_error_and_nothing_is_written(
    env,
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await valkey().set(keys.receipts, b"not a hash")

    outcome = await admit(env, head, "u-1", edit(env.base, " lost"))

    assert outcome == AdmissionOutcome(AdmissionStatus.TYPE_ERROR)
    assert await valkey().exists(keys.stream) == 0
    assert await valkey().hget(keys.control, "head") == b"0"
    assert await valkey().get(keys.receipts) == b"not a hash"


async def test_document_record_limit_refuses_further_edits_without_trimming(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcomes = {
        (await admit(env, head, f"u-{index}", b"x")).status
        for index in range(MAX_PENDING_DOCUMENT_RECORDS)
    }
    refused = await admit(env, head, "over", b"x")

    assert outcomes == {AdmissionStatus.ACCEPTED}
    assert refused == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert await valkey().xlen(keys.stream) == MAX_PENDING_DOCUMENT_RECORDS
    assert (await valkey().xrange(keys.stream, count=1))[0][0] == b"1-0"


async def test_document_byte_limit_refuses_further_edits_without_trimming(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    chunk = b"x" * MAX_FRAME_BYTES

    outcomes = {
        (await admit(env, head, f"u-{index}", chunk)).status
        for index in range(MAX_PENDING_DOCUMENT_BYTES // MAX_FRAME_BYTES)
    }
    refused = await admit(env, head, "over", b"x")

    assert outcomes == {AdmissionStatus.ACCEPTED}
    assert refused == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        MAX_PENDING_DOCUMENT_BYTES, MAX_PENDING_DOCUMENT_BYTES // MAX_FRAME_BYTES
    )


async def test_one_document_holds_a_quarter_of_its_bucket_and_the_bucket_refuses_at_budget(
    env, bucket_mates
) -> None:
    owner = await establish(env)
    small = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUCKET_COUNT * 400)
    mates = [await establish(env, key) for key in await bucket_mates(owner.scope.bucket, 4)]

    filled = await admit(env, owner, "u-1", b"x" * 100, buffer=small)
    capped = await admit(env, owner, "u-2", b"x", buffer=small)
    others = [await admit(env, head, "u-1", b"y" * 100, buffer=small) for head in mates[:3]]
    exhausted = await admit(env, mates[3], "u-1", b"z", buffer=small)

    assert filled.status is AdmissionStatus.ACCEPTED
    assert capped == AdmissionOutcome(AdmissionStatus.DOCUMENT_LIMIT)
    assert {outcome.status for outcome in others} == {AdmissionStatus.ACCEPTED}
    assert exhausted == AdmissionOutcome(AdmissionStatus.BUDGET_EXHAUSTED)
    assert await valkey().xlen(buffer_keys(owner.scope, env.namespace).stream) == 1
    assert await small.bucket_usage(owner.scope.bucket) == PendingUsage(400, 4)


class EvictingValkey:
    config = {"maxmemory-policy": "allkeys-lru", "maxmemory": "0"}

    async def info(self, section: str) -> dict[str, object]:
        if section == "server":
            return {"run_id": STALE_RUN_ID, "valkey_version": "9.1.2"}
        return {"aof_enabled": 1}

    async def config_get(self, pattern: str) -> dict[str, str]:
        return {pattern: self.config[pattern]} if pattern in self.config else {}


async def test_disabled_preflight_refuses_admission_as_retryable(env) -> None:
    head = await establish(env)
    await run_preflight(EvictingValkey())
    try:
        with pytest.raises(BufferUnavailable):
            await admit(env, head, "u-1", edit(env.base, " refused"))
    finally:
        await run_preflight(valkey())

    assert await valkey().exists(buffer_keys(head.scope, env.namespace).stream) == 0


class ValkeyRelay:
    """TCP relay to Valkey that can swallow replies or pose as a restarted server."""

    def __init__(self) -> None:
        config = ValkeyConfig.from_env()
        self._upstream = (config.host, config.port)
        self.dropping = False
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
                if not (replies and self.dropping):
                    writer.write(data)
                    await writer.drain()
        finally:
            writer.close()


@pytest_asyncio.fixture(loop_scope="session")
async def proxied() -> AsyncIterator[tuple[ValkeyRelay, aioredis.Redis]]:
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


async def test_timeout_after_append_raises_unknown_and_retry_returns_the_same_sequence(
    env, proxied
) -> None:
    proxy, client = proxied
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    first, second = edit(env.base, " Alice"), edit(env.base, " Bob")
    through_proxy = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET, client=client)
    await admit(env, head, "u-1", first)
    assert await client.ping() is True

    proxy.dropping = True
    with pytest.raises(AdmissionUnknown) as unknown:
        await admit(env, head, "u-2", second, buffer=through_proxy)

    assert unknown.value.update_id == "u-2"
    entries = await valkey().xrange(keys.stream)
    assert [(entry_id, fields[b"u"]) for entry_id, fields in entries] == [
        (b"1-0", first),
        (b"2-0", second),
    ]
    retried = await admit(env, head, "u-2", second)
    assert retried == AdmissionOutcome(AdmissionStatus.DUPLICATE, receipt(head, 2, "u-2"))


async def test_loader_rebuilds_on_cache_miss_and_reuses_the_checkpoint_on_hit(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))

    first = await latest(env)
    assert first is not None
    assert first.head == BufferHead(head.scope, 1, 0, head.checkpoint_revision, head.run_id)
    assert first.checkpoint == env.base
    assert [record.update_id for record in first.tail] == ["u-1"]
    assert text_of(first.merged()) == "base Alice"

    replaced = pycrdt.Doc()
    markdown_text(replaced).insert(0, "rewritten")
    await set_row(env.key, updates=replaced.get_update())
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    hit = await latest(env)

    assert hit is not None
    assert hit.checkpoint == env.base
    assert [record.update_id for record in hit.tail] == ["u-1", "u-2"]
    assert hit.head.head_seq == 2

    await set_row(env.key, revision=RealtimeYjsSnapshot.revision + 1)
    miss = await latest(env)

    assert miss is not None
    assert miss.checkpoint == replaced.get_update()
    assert miss.head.checkpoint_revision == head.checkpoint_revision + 1
    assert [record.update_id for record in miss.tail] == ["u-1", "u-2"]


async def test_loader_returns_nothing_for_a_document_without_a_checkpoint(env) -> None:
    assert await latest(env, (ContentType.NOTE, uuid4())) is None


async def test_loader_reports_a_gap_in_the_tail(env) -> None:
    head = await establish(env)
    for index in range(3):
        await admit(env, head, f"u-{index}", edit(env.base, f" {index}"))
    await valkey().xdel(buffer_keys(head.scope, env.namespace).stream, "2-0")

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)

    assert failure.value.reason is RecoveryReason.GAP


async def test_loader_reports_a_tail_below_the_postgres_watermark(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await set_row(env.key, checkpoint_seq=5)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)

    assert failure.value.reason is RecoveryReason.STALE_TAIL


async def test_missing_control_is_reported_then_reset_keeps_the_surviving_prefix(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    await valkey().delete(buffer_keys(head.scope, env.namespace).control)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)
    fresh = await establish(env)
    state = await latest(env)

    assert failure.value.reason is RecoveryReason.MISSING_CONTROL
    assert fresh.scope.epoch != head.scope.epoch
    assert state is not None
    assert state.tail == ()
    assert text_of(state.checkpoint) in {"base Alice Bob", "base Bob Alice"}


async def test_run_id_change_forces_a_fresh_epoch_with_the_surviving_prefix_staged(env) -> None:
    head = await establish(env)
    old_keys = buffer_keys(head.scope, env.namespace)
    old = await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    # The epoch was issued by an instance that has since restarted, keys intact.
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)

    with pytest.raises(RecoveryRequired) as failure:
        await latest(env)
    fresh = await establish(env)

    assert failure.value.reason is RecoveryReason.IDENTITY_CHANGED
    row = await stored_row(env.key)
    identity = server_identity()
    assert identity is not None
    assert fresh.scope.generation == head.scope.generation == row.generation
    assert fresh.scope.epoch != head.scope.epoch
    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        fresh.scope.epoch,
        identity.run_id,
        0,
    )
    assert (fresh.head_seq, fresh.checkpoint_seq) == (0, 0)
    assert row.revision == head.checkpoint_revision + 1
    assert row.actor_id == env.actor
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await valkey().exists(old_keys.stream, old_keys.control, old_keys.receipts) == 0
    assert await valkey().zscore(old_keys.due, head.scope.member) is None
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)

    carol = await admit(env, fresh, "u-3", edit(env.base, " Carol"))

    # Sequence 1 is issued again, but only inside the new epoch, so the old receipt never matches.
    assert carol == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(fresh, 1, "u-3"))
    assert old == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(head, 1, "u-1"))
    state = await latest(env)
    assert state is not None
    assert [record.update_id for record in state.tail] == ["u-3"]
    assert "Carol" in text_of(state.merged()) and "Alice" in text_of(state.merged())


async def test_admission_under_a_head_from_another_instance_requires_recovery(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)

    outcome = await admit(
        env, dataclasses.replace(head, run_id=STALE_RUN_ID), "u-1", edit(env.base, " late")
    )

    assert outcome == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert await valkey().exists(keys.stream, keys.receipts) == 0


async def test_admission_with_a_retired_epoch_requires_recovery(env) -> None:
    head = await establish(env)
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)
    await establish(env)

    stale = await admit(env, head, "u-1", edit(env.base, " late"))

    assert stale == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert await valkey().exists(buffer_keys(head.scope, env.namespace).stream) == 0


async def test_failed_staging_leaves_the_old_epoch_intact_for_retry(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)

    async def interrupted(*_: Any) -> None:
        raise OSError("database connection lost")

    with pytest.raises(OSError):
        await establish(env, stage=interrupted)
    row = await stored_row(env.key)

    assert (row.buffer_epoch, row.valkey_run_id, row.checkpoint_seq) == (
        head.scope.epoch,
        STALE_RUN_ID,
        0,
    )
    assert await valkey().xlen(buffer_keys(head.scope, env.namespace).stream) == 1

    retried = await establish(env)

    assert retried.scope.epoch != head.scope.epoch
    assert text_of((await stored_row(env.key)).updates) == "base Alice"


async def test_reset_interrupted_before_control_initialization_moves_to_a_fresh_epoch(
    env,
) -> None:
    first = await establish(env)
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)
    committed = await establish(env)
    # Same stored state as a Valkey that lost the control record after the epoch commit.
    await valkey().delete(buffer_keys(committed.scope, env.namespace).control)

    settled = await establish(env)
    outcome = await admit(env, settled, "u-1", edit(env.base, " Alice"))

    assert len({first.scope.epoch, committed.scope.epoch, settled.scope.epoch}) == 3
    assert outcome == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(settled, 1, "u-1"))
    assert await valkey().exists(buffer_keys(committed.scope, env.namespace).control) == 0
    assert (await stored_row(env.key)).buffer_epoch == settled.scope.epoch


async def test_forced_reset_after_a_gap_stages_only_the_contiguous_prefix(env) -> None:
    head = await establish(env)
    for index, name in enumerate((" Alice", " Bob", " Carol")):
        await admit(env, head, f"u-{index}", edit(env.base, name))
    await valkey().xdel(buffer_keys(head.scope, env.namespace).stream, "2-0")

    fresh = await establish(env, reset=RecoveryReason.GAP)

    assert fresh.scope.epoch != head.scope.epoch
    assert text_of((await stored_row(env.key)).updates) == "base Alice"
    # The record beyond the gap stays for investigation instead of being trimmed away.
    leftover = await valkey().xrange(buffer_keys(head.scope, env.namespace).stream)
    assert [entry_id for entry_id, _ in leftover] == [b"3-0"]


async def test_trim_through_a_committed_sequence_keeps_the_newer_tail(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    payloads = [edit(env.base, name) for name in (" Alice", " Bob", " Carol")]
    for index, payload in enumerate(payloads, start=1):
        await admit(env, head, f"u-{index}", payload)
    due = await valkey().zscore(keys.due, head.scope.member)

    partial = await env.buffer.trim_committed(head.scope, 2)

    assert partial == TrimResult(len(payloads[0]) + len(payloads[1]), 2, 1)
    assert [entry_id for entry_id, _ in await valkey().xrange(keys.stream)] == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-3"}
    assert await valkey().zscore(keys.due, head.scope.member) == due
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(len(payloads[2]), 1)

    complete = await env.buffer.trim_committed(head.scope, 3)

    assert complete == TrimResult(len(payloads[2]), 1, 0)
    assert await valkey().zscore(keys.due, head.scope.member) is None
    assert await valkey().hget(keys.control, "first_ms") is None
    assert await valkey().hget(keys.control, "head") == b"3"


async def test_accounting_repair_recomputes_counters_from_the_streams(env) -> None:
    heads = [await establish(env, key) for key in env.keys]
    sizes: dict[int, PendingUsage] = {}
    for position, (head, base) in enumerate(zip(heads, env.bases, strict=True)):
        for index in range(position + 2):
            await admit(env, head, f"u-{index}", edit(base, f" {position}-{index}"))
    victim = buffer_keys(heads[0].scope, env.namespace)
    removed = (await valkey().xrange(victim.stream, count=1))[0]
    await valkey().xdel(victim.stream, removed[0])
    await valkey().hset(buffer_keys(heads[1].scope, env.namespace).control, "bytes", 1)
    for head in heads:
        await valkey().hset(accounting_key(head.scope.bucket, env.namespace), "bytes", 999_999)
    for head in heads:
        entries = await valkey().xrange(buffer_keys(head.scope, env.namespace).stream)
        current = sizes.get(head.scope.bucket, PendingUsage(0, 0))
        sizes[head.scope.bucket] = PendingUsage(
            current.bytes + sum(len(fields[b"u"]) for _, fields in entries),
            current.records + len(entries),
        )

    repaired = {bucket: await env.buffer.repair_accounting(bucket) for bucket in sizes}

    assert repaired == sizes
    for bucket, usage in sizes.items():
        assert await env.buffer.bucket_usage(bucket) == usage
    for head in heads:
        keys = buffer_keys(head.scope, env.namespace)
        entries = await valkey().xrange(keys.stream)
        control = await valkey().hgetall(keys.control)
        assert int(control[b"bytes"]) == sum(len(fields[b"u"]) for _, fields in entries)
        assert int(control[b"records"]) == len(entries)


async def test_concurrent_first_establishments_settle_on_one_epoch_with_one_reset(env) -> None:
    before = epoch_resets(RecoveryReason.UNINITIALIZED)

    heads = await asyncio.gather(*(establish(env) for _ in range(3)))

    assert len({head.scope.epoch for head in heads}) == 1
    assert epoch_resets(RecoveryReason.UNINITIALIZED) == before + 1
    assert (await stored_row(env.key)).buffer_epoch == heads[0].scope.epoch
    assert await valkey().hget(buffer_keys(heads[0].scope, env.namespace).control, "head") == b"0"


async def test_reset_retires_records_the_checkpoint_already_covers(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    # A checkpoint covered both records, then Valkey restarted before cleanup trimmed them.
    await set_row(env.key, checkpoint_seq=2, valkey_run_id=STALE_RUN_ID)

    fresh = await establish(env)

    old = buffer_keys(head.scope, env.namespace)
    assert fresh.scope.epoch != head.scope.epoch
    assert await valkey().exists(old.stream, old.control, old.receipts) == 0
    assert await valkey().zscore(old.due, head.scope.member) is None
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)


async def test_reset_after_a_lost_stream_releases_its_pending_bytes(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    # Eviction or an operator removed the stream; its control and the bucket total survived.
    await valkey().delete(buffer_keys(head.scope, env.namespace).stream)

    with pytest.raises(RecoveryRequired) as lost:
        await latest(env)
    fresh = await establish(env, reset=lost.value.reason)

    assert lost.value.reason is RecoveryReason.GAP
    assert fresh.scope.epoch != head.scope.epoch
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)
    assert text_of((await stored_row(env.key)).updates) == "base"


async def test_restarted_valkey_refuses_appends_until_the_document_moves_to_a_fresh_epoch(
    env, relayed
) -> None:
    head = await establish(env)
    alice = await admit(env, head, "u-1", edit(env.base, " Alice"))

    await relayed.restart(RESTARTED_RUN_IDS[0])
    refused = await admit(env, head, "u-2", edit(env.base, " Bob"))
    adopted = server_identity()
    fresh = await establish(env)
    carol = await admit(env, fresh, "u-3", edit(env.base, " Carol"))

    await relayed.restart(RESTARTED_RUN_IDS[1])
    with pytest.raises(RecoveryRequired) as lost:
        await latest(env)
    readopted = server_identity()
    settled = await establish(env)

    assert alice.status is AdmissionStatus.ACCEPTED
    assert refused == AdmissionOutcome(AdmissionStatus.RECOVERY_REQUIRED)
    assert adopted is not None and adopted.run_id == RESTARTED_RUN_IDS[0]
    assert fresh.scope.epoch != head.scope.epoch
    assert fresh.run_id == RESTARTED_RUN_IDS[0]
    assert carol == AdmissionOutcome(AdmissionStatus.ACCEPTED, receipt(fresh, 1, "u-3"))
    assert lost.value.reason is RecoveryReason.IDENTITY_CHANGED
    assert readopted is not None and readopted.run_id == RESTARTED_RUN_IDS[1]
    assert settled.scope.epoch not in {head.scope.epoch, fresh.scope.epoch}
    row = await stored_row(env.key)
    assert (row.buffer_epoch, row.valkey_run_id) == (settled.scope.epoch, RESTARTED_RUN_IDS[1])
    text = text_of(row.updates)
    assert "Alice" in text and "Carol" in text and "Bob" not in text
