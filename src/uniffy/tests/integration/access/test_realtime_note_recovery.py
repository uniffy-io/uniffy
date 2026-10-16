"""Trash, restore, purge and projection recovery keep accepted note edits."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.models.tags.tag import TAG_NAME_MAX_LENGTH, Tag, TagAssignment
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.jobs import RECOVERY_BATCH_SIZE, recover_realtime_projections
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import EditDenied, decode_snapshot, load_snapshot, lock_document
from uniffy.core.search.engine import SearchEngineError
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.hierarchy.operations import NoteHierarchy
from uniffy.domains.notes.operations import NoteOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import buffered, typed
from uniffy.tests.integration.access.recording_search import (
    RecordingSearchEngine,
    recording_indexer,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

BASE_CONTENT = "base"
ACCEPTED_SUFFIX = " accepted before delete"
# Older than any row the stack writes, so the sweep reaches these rows first.
LONG_AGO = datetime(2000, 1, 1, tzinfo=UTC)


@pytest_asyncio.fixture(loop_scope="session")
async def note_document(session, access, valkey_namespace):
    key = ContentType.NOTE, access.private_note_id
    await session.execute(update(Note).where(Note.id == key[1]).values(content=BASE_CONTENT))
    await session.commit()
    engine = RecordingSearchEngine()
    indexer = recording_indexer(engine)
    register_realtime_adapter(NoteRealtimeAdapter(indexer))
    live = await buffered(key, access, valkey_namespace)
    await live.admit("u-accepted", typed(live.base, suffix=ACCEPTED_SUFFIX))
    accepted = await live.checkpointed()
    try:
        yield SimpleNamespace(
            key=key,
            access=access,
            accepted=accepted,
            engine=engine,
            indexer=indexer,
            live=live,
        )
    finally:
        await session.rollback()
        await session.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.organization_id == access.org_id)
        )
        await session.commit()


async def first_in_line(key) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(RealtimeYjsSnapshot.content_id == key[1])
            .values(updated_at=LONG_AGO)
        )
        await db.commit()


def hierarchy(session, document) -> NoteHierarchy:
    operations = NoteOperations(
        session, MagicMock(spec=ObjectStorage), document.indexer, document.live.buffer
    )
    return NoteHierarchy(operations, document.live.buffer, enqueue=document.live.jobs)


async def test_trash_preserves_accepted_edits_until_restore(session, note_document):
    document = note_document
    access = document.access
    operations = hierarchy(session, document)
    await operations.delete(access.member_id, access.org_id, document.key[1])

    outcome = await persist_snapshot(*document.key, access.org_id)
    assert outcome is SnapshotOutcome.SNAPSHOT_ONLY
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        note = await db.get(Note, document.key[1])
        assert snapshot.updates == document.accepted.updates
        assert snapshot.revision > snapshot.rendered_revision
        assert note.is_deleted
        assert note.content == BASE_CONTENT

    denied = decode_snapshot(document.accepted)
    markdown_text(denied).insert(0, "denied ")
    with pytest.raises(EditDenied):
        await document.live.admit_live("u-denied", denied.get_update())

    await operations.restore(access.member_id, access.org_id, document.key[1])
    outcome = await persist_snapshot(*document.key, access.org_id)
    assert outcome is SnapshotOutcome.RENDERED
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        note = await db.get(Note, document.key[1])
        assert not note.is_deleted
        assert note.content == BASE_CONTENT + ACCEPTED_SUFFIX
        assert snapshot.generation == document.accepted.generation
        assert snapshot.rendered_revision == snapshot.revision
    assert BASE_CONTENT + ACCEPTED_SUFFIX in (document.engine.indexed_text(*document.key) or "")


async def test_unchanged_projection_preserves_content_version_and_timestamp(note_document):
    document = note_document
    await persist_snapshot(*document.key, document.access.org_id)
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        version, updated_at = note.version, note.updated_at
        snapshot = await load_snapshot(db, document.key)
        snapshot.rendered_revision = 0
        await db.commit()
    await persist_snapshot(*document.key, document.access.org_id)
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        assert (note.version, note.updated_at) == (version, updated_at)
        assert snapshot.rendered_revision == snapshot.revision


async def test_recovery_projects_new_content_while_search_is_unavailable(note_document):
    document = note_document
    org_id = document.access.org_id
    document.engine.available = False
    with pytest.raises(SearchEngineError):
        await persist_snapshot(*document.key, org_id)
    doc = decode_snapshot(document.accepted)
    markdown_text(doc).insert(0, "latest ")
    await document.live.admit("u-latest", doc.get_update())
    await document.live.checkpointed()
    await first_in_line(document.key)

    await recover_realtime_projections({}, organization_id=org_id)

    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        assert note.content == "latest " + BASE_CONTENT + ACCEPTED_SUFFIX
        assert snapshot.rendered_revision == snapshot.revision
        assert snapshot.effects_pending
    assert document.engine.indexed_text(*document.key) is None

    document.engine.available = True
    await first_in_line(document.key)
    await recover_realtime_projections({}, organization_id=org_id)
    async with open_session() as db:
        assert not (await load_snapshot(db, document.key)).effects_pending
    assert note.content in (document.engine.indexed_text(*document.key) or "")


async def test_restore_waits_for_document_transaction(session, note_document):
    document = note_document
    access = document.access
    await session.execute(update(Note).where(Note.id == document.key[1]).values(is_deleted=True))
    await session.commit()

    async def restore():
        async with open_session() as db:
            operations = hierarchy(db, document)
            return await operations.restore(access.member_id, access.org_id, document.key[1])

    async with open_session() as db:
        await lock_document(db, document.key)
        restoring = asyncio.create_task(restore())
        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(restoring), timeout=0.1)
        finally:
            await db.rollback()
            restored = await asyncio.wait_for(restoring, timeout=5)
    assert not restored.is_deleted


async def test_hard_purge_removes_preserved_snapshot(session, note_document):
    document = note_document
    access = document.access
    operations = hierarchy(session, document)
    await operations.delete(access.member_id, access.org_id, document.key[1])
    await persist_snapshot(*document.key, access.org_id)
    await operations.empty_trash(access.member_id, access.org_id)
    async with open_session() as db:
        assert await load_snapshot(db, document.key) is None
        assert await db.get(Note, document.key[1]) is None


@pytest.mark.parametrize("tag_length", [TAG_NAME_MAX_LENGTH, TAG_NAME_MAX_LENGTH + 1, 1000])
async def test_inline_tag_length_cannot_block_projection(note_document, tag_length):
    document = note_document
    access = document.access
    # Multibyte names exercise PostgreSQL's character limit, rather than a byte limit.
    name = "tag" + "é" * (tag_length - 3)
    text = f"base [[[tag|{name}]]] [[[tag|valid]]]"
    doc = decode_snapshot(document.accepted)
    markdown = markdown_text(doc)
    del markdown[:]
    markdown.insert(0, text)
    await document.live.admit("u-tags", doc.get_update())
    await document.live.checkpointed()
    assert await persist_snapshot(*document.key, access.org_id) is SnapshotOutcome.RENDERED
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        tags = (
            (
                await db.execute(
                    select(Tag.name)
                    .join(TagAssignment, TagAssignment.tag_id == Tag.id)
                    .where(TagAssignment.content_urn == build_content_urn(*document.key))
                )
            )
            .scalars()
            .all()
        )
        assert note.content == text
        assert snapshot.rendered_revision == snapshot.revision
        assert set(tags) == ({"valid", name} if tag_length <= TAG_NAME_MAX_LENGTH else {"valid"})


def _pending(note: Note, updates: bytes, updated_at: datetime) -> RealtimeYjsSnapshot:
    return RealtimeYjsSnapshot(
        content_type=ContentType.NOTE,
        content_id=note.id,
        organization_id=note.organization_id,
        revision=1,
        rendered_revision=0,
        state_vector=b"",
        updates=updates,
        updated_at=updated_at,
    )


def _markdown_update(text: str) -> bytes:
    doc = pycrdt.Doc()
    markdown_text(doc).insert(0, text)
    return doc.get_update()


@pytest.mark.parametrize("deferred", [False, True])
async def test_recovery_batch_advances_past_unrenderable_rows(session, access, deferred):
    register_realtime_adapter(NoteRealtimeAdapter(recording_indexer()))
    # A full batch of rows that cannot render: trashed notes defer, corrupt bytes fail.
    stuck = [
        Note(
            organization_id=access.org_id,
            owner_id=access.member_id,
            title="Stuck",
            slug=f"stuck-{generate_id().hex}",
            is_deleted=deferred,
        )
        for _ in range(RECOVERY_BATCH_SIZE)
    ]
    waiting = Note(
        organization_id=access.org_id,
        owner_id=access.member_id,
        title="Waiting",
        slug=f"waiting-{generate_id().hex}",
        content="",
    )
    session.add_all([*stuck, waiting])
    await session.flush()
    unrenderable = _markdown_update("trashed") if deferred else b"\x01\x02\x03"
    session.add_all(
        _pending(note, unrenderable, LONG_AGO + timedelta(seconds=index))
        for index, note in enumerate(stuck)
    )
    session.add(_pending(waiting, _markdown_update("rendered"), LONG_AGO + timedelta(days=1)))
    await session.commit()
    ids = [note.id for note in (*stuck, waiting)]

    async def rendered() -> bool:
        async with open_session() as db:
            row = await load_snapshot(db, (ContentType.NOTE, waiting.id))
            return row.rendered_revision == row.revision

    try:
        await recover_realtime_projections({}, organization_id=access.org_id)
        assert not await rendered()
        # The stuck rows moved behind the waiting one without losing their revision.
        async with open_session() as db:
            rows = (
                await db.scalars(
                    select(RealtimeYjsSnapshot).where(
                        RealtimeYjsSnapshot.content_id.in_([note.id for note in stuck])
                    )
                )
            ).all()
        assert len(rows) == RECOVERY_BATCH_SIZE
        assert all(row.updated_at > LONG_AGO + timedelta(days=1) for row in rows)
        assert {(row.revision, row.rendered_revision, row.updates) for row in rows} == {
            (1, 0, unrenderable)
        }

        await recover_realtime_projections({}, organization_id=access.org_id)
        assert await rendered()
        async with open_session() as db:
            assert (await db.get(Note, waiting.id)).content == "rendered"
    finally:
        await session.rollback()
        await session.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id.in_(ids))
        )
        await session.commit()
