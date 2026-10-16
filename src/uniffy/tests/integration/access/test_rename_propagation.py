"""Mention label renames across documents whose accepted edits wait in the realtime buffer."""

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from prometheus_client import REGISTRY
from sqlalchemy import delete, select

from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.rename import RENAME_BATCH_DOCUMENTS
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import lock_document, stage_seed
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.search.jobs.contracts import REINDEX_RENAMED_CONTENT
from uniffy.domains.search.metrics import RenameSkip
from uniffy.domains.search.rename import propagate_rename
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BUDGET,
    BufferedDocument,
    Recorder,
    establish,
    live_note,  # noqa: F401 - fixture
    stored,
    text_of,
    typed,
    unreachable,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture(autouse=True)
def note_adapter() -> None:
    register_realtime_adapter(NoteRealtimeAdapter(AsyncMock()))


@pytest_asyncio.fixture(loop_scope="session")
async def org_snapshots(access) -> AsyncIterator[None]:
    """Drops the snapshot rows the test seeded in its organization."""
    try:
        yield
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.organization_id == access.org_id
                )
            )
            await db.commit()


def mention(urn: str, label: str) -> str:
    return f"[[[{label}|{urn}]]]"


def user_urn(access: NS) -> str:
    return f"urn:uniffy:content:USER:{access.peer_id}"


def fresh_urn() -> str:
    """A target no earlier test mentioned, so the candidate set is this test's notes alone."""
    return f"urn:uniffy:content:USER:{generate_id()}"


async def mentioning_note(access: NS, urn: str, *, seeded: bool = False) -> DocKey:
    """A note whose column mentions ``urn``; ``seeded`` also gives it a snapshot row."""
    async with open_session() as db:
        note = Note(
            organization_id=access.org_id,
            owner_id=access.member_id,
            title="Mentions",
            slug=f"mentions-{generate_id().hex}",
            content=f"see {mention(urn, 'Old')}",
            outgoing_references=[urn],
        )
        db.add(note)
        await db.commit()
        key = (ContentType.NOTE, note.id)
        if seeded:
            await lock_document(db, key, access.org_id)
            await stage_seed(db, key, access.org_id)
            await db.commit()
    return key


async def columns(*keys: DocKey) -> dict[DocKey, tuple[str | None, int]]:
    async with open_session() as db:
        rows = await db.execute(
            select(Note.id, Note.content, Note.version).where(Note.id.in_([key[1] for key in keys]))
        )
    return {(ContentType.NOTE, note_id): (content, version) for note_id, content, version in rows}


def skipped(reason: RenameSkip) -> float:
    sample = REGISTRY.get_sample_value(
        "uniffy_mention_rename_skipped_total", {"reason": reason.value}
    )
    return sample or 0.0


def reindexed(jobs: Recorder) -> list[list[str]]:
    return [
        loads(args[0])["note_ids"]
        for name, _, args in jobs.jobs
        if name == REINDEX_RENAMED_CONTENT.name
    ]


async def test_rename_keeps_a_pending_tail_and_relabels_every_mentioning_document(
    live_note: BufferedDocument, access, org_snapshots
) -> None:
    urn = user_urn(access)
    tail = typed(live_note.base, suffix=f" {mention(urn, 'Old')} human")
    await live_note.admit("u-mention", tail, live_note.peer)
    plain = await mentioning_note(access, urn)
    seeded = await mentioning_note(access, urn, seeded=True)
    seeded_generation = (await stored(seeded)).generation

    async with open_session() as db:
        renamed = await propagate_rename(
            db, access.org_id, urn, "Renamed", buffer=live_note.buffer, enqueue=live_note.jobs
        )

    assert renamed == 3
    row = await stored(live_note.key)
    assert text_of(row.updates) == f"base {mention(urn, 'Renamed')} human"
    assert (row.generation, row.buffer_epoch, row.checkpoint_seq) == (
        live_note.generation,
        live_note.head.scope.epoch,
        1,
    )
    assert (await live_note.buffer_state())["stream"] == []
    seeded_row = await stored(seeded)
    assert text_of(seeded_row.updates) == f"see {mention(urn, 'Renamed')}"
    assert seeded_row.generation == seeded_generation
    assert await columns(live_note.key, plain, seeded) == {
        # The tail reaches this column when the scheduled projection renders it.
        live_note.key: ("base", 2),
        plain: (f"see {mention(urn, 'Renamed')}", 2),
        seeded: (f"see {mention(urn, 'Renamed')}", 2),
    }
    projected = {
        args[1] for name, _, args in live_note.jobs.jobs if name == SAVE_REALTIME_SNAPSHOT.name
    }
    assert projected == {str(live_note.key[1]), str(seeded[1])}
    assert [sorted(ids) for ids in reindexed(live_note.jobs)] == [
        sorted(str(key[1]) for key in (live_note.key, plain, seeded))
    ]

    # The peer keeps typing after the label it saw; the epoch still takes and checkpoints it.
    await live_note.admit("u-late", typed(live_note.base, tail, suffix=" later"), live_note.peer)
    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    assert text_of((await stored(live_note.key)).updates) == (
        f"base {mention(urn, 'Renamed')} human later"
    )


async def test_rename_commits_batches_of_bounded_size_in_lock_order(
    access, valkey_namespace
) -> None:
    urn = user_urn(access)
    async with open_session() as db:
        notes = [
            Note(
                organization_id=access.org_id,
                owner_id=access.member_id,
                title=f"Mentions {index}",
                slug=f"mentions-{generate_id().hex}",
                content=f"see {mention(urn, 'Old')}",
                outgoing_references=[urn],
            )
            for index in range(RENAME_BATCH_DOCUMENTS + 1)
        ]
        db.add_all(notes)
        await db.commit()
    keys = [(ContentType.NOTE, note.id) for note in notes]
    jobs = Recorder()

    async with open_session() as db:
        renamed = await propagate_rename(
            db,
            access.org_id,
            urn,
            "Renamed",
            buffer=UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET),
            enqueue=jobs,
        )

    assert renamed == RENAME_BATCH_DOCUMENTS + 1
    ordered = sorted(str(key[1]) for key in keys)
    assert reindexed(jobs) == [ordered[:RENAME_BATCH_DOCUMENTS], ordered[RENAME_BATCH_DOCUMENTS:]]
    assert set((await columns(*keys)).values()) == {(f"see {mention(urn, 'Renamed')}", 2)}


async def pending_mention(buffer: UpdateBuffer, access: NS, urn: str, update: bytes | None = None):
    """A mentioning note with a buffer epoch and one accepted edit waiting for a checkpoint."""
    key = await mentioning_note(access, urn, seeded=True)
    head = await establish(buffer, key, access.org_id)
    edit = update or typed((await stored(key)).updates, suffix=" pending")
    outcome = await buffer.admit(head, update_id="u-pending", update=edit, actor_id=access.member_id)
    assert outcome.receipt is not None
    return key, head, edit


def checkpoint_of(row: RealtimeYjsSnapshot) -> tuple:
    return (row.updates, row.revision, row.checkpoint_seq, row.buffer_epoch, row.generation)


async def test_unreachable_buffer_still_renames_documents_without_live_state(
    access, valkey_namespace, org_snapshots
) -> None:
    urn = fresh_urn()
    buffer = UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)
    plain = await mentioning_note(access, urn)
    pending, head, edit = await pending_mention(buffer, access, urn)
    snapshot = await stored(pending)
    before = await columns(pending)
    scans, documents = skipped(RenameSkip.BUFFER_SCAN), skipped(RenameSkip.DOCUMENT)
    jobs = Recorder()

    async with unreachable(valkey_namespace) as outage, open_session() as db:
        renamed = await propagate_rename(
            db, access.org_id, urn, "Renamed", buffer=outage, enqueue=jobs
        )
        # The skipped document holds no lock while the caller's request goes on.
        async with open_session() as other:
            await asyncio.wait_for(lock_document(other, pending, access.org_id), timeout=5)
        # A later commit by the caller must not persist any of the skipped document.
        await db.commit()

    assert renamed == 1
    assert (await columns(plain))[plain] == (f"see {mention(urn, 'Renamed')}", 2)
    assert await columns(pending) == before
    assert checkpoint_of(await stored(pending)) == checkpoint_of(snapshot)
    tail = await buffer.read_updates(head.scope, after=0, through=1)
    assert [(record.update_id, record.update) for record in tail] == [("u-pending", edit)]
    assert reindexed(jobs) == [[str(plain[1])]]
    assert (skipped(RenameSkip.BUFFER_SCAN), skipped(RenameSkip.DOCUMENT)) == (
        scans + 1,
        documents + 1,
    )


async def test_one_unreadable_tail_is_skipped_while_the_rest_of_its_batch_is_renamed(
    access, valkey_namespace, org_snapshots
) -> None:
    urn = fresh_urn()
    buffer = UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET)
    plain = await mentioning_note(access, urn)
    seeded = await mentioning_note(access, urn, seeded=True)
    healthy, _, _ = await pending_mention(buffer, access, urn)
    poisoned, head, garbage = await pending_mention(buffer, access, urn, b"not a yjs update")
    snapshot = await stored(poisoned)
    before = await columns(poisoned)
    documents = skipped(RenameSkip.DOCUMENT)
    jobs = Recorder()

    async with open_session() as db:
        renamed = await propagate_rename(
            db, access.org_id, urn, "Renamed", buffer=buffer, enqueue=jobs
        )
        async with open_session() as other:
            await asyncio.wait_for(lock_document(other, poisoned, access.org_id), timeout=5)
        await db.commit()

    assert renamed == 3
    relabelled = f"see {mention(urn, 'Renamed')}"
    assert await columns(plain, seeded, healthy, poisoned) == {
        plain: (relabelled, 2),
        seeded: (relabelled, 2),
        healthy: (relabelled, 2),
        poisoned: before[poisoned],
    }
    assert text_of((await stored(healthy)).updates) == f"{relabelled} pending"
    assert checkpoint_of(await stored(poisoned)) == checkpoint_of(snapshot)
    tail = await buffer.read_updates(head.scope, after=0, through=1)
    assert [(record.update_id, record.update) for record in tail] == [("u-pending", garbage)]
    assert [sorted(ids) for ids in reindexed(jobs)] == [
        sorted(str(key[1]) for key in (plain, seeded, healthy))
    ]
    assert skipped(RenameSkip.DOCUMENT) == documents + 1
