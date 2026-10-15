import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.models.tags.tag import TAG_NAME_MAX_LENGTH, Tag, TagAssignment
from uniffy.core.realtime import jobs
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import (
    EditDenied,
    accept_update,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.operations import NoteOperations
from uniffy.infrastructure.database.session import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

BASE_CONTENT = "base"
ACCEPTED_SUFFIX = " accepted before delete"


@pytest_asyncio.fixture(loop_scope="session")
async def note_document(session, access):
    key = ContentType.NOTE, access.private_note_id
    await session.execute(update(Note).where(Note.id == key[1]).values(content=BASE_CONTENT))
    await session.commit()
    indexer = MagicMock()
    indexer.remove = AsyncMock()
    adapter = NoteRealtimeAdapter(indexer)
    with (
        patch("uniffy.core.realtime.storage.get_realtime_adapter", return_value=adapter),
        patch("uniffy.core.realtime.snapshot.get_realtime_adapter", return_value=adapter),
        patch(
            "uniffy.domains.notes.projection.NoteProjectionOperations._index_for_search",
            new_callable=AsyncMock,
        ),
        patch(
            "uniffy.domains.notes.projection.NoteProjectionOperations._notify_new_mentions",
            new_callable=AsyncMock,
        ),
        patch(
            "uniffy.domains.notes.content.realtime.finish_inline_tags_after_commit",
            new_callable=AsyncMock,
        ),
    ):
        await lock_document(session, key)
        seed = await stage_seed(session, key, access.org_id)
        await session.commit()
        doc = decode_snapshot(seed)
        markdown_text(doc).insert(len(BASE_CONTENT), ACCEPTED_SUFFIX)
        accepted = await accept_update(
            key, access.org_id, access.member_id, seed.generation, doc.get_update()
        )
        try:
            yield SimpleNamespace(
                key=key,
                access=access,
                accepted=accepted,
                indexer=indexer,
                adapter=adapter,
            )
        finally:
            await session.rollback()
            await session.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.organization_id == access.org_id
                )
            )
            await session.commit()


async def test_trash_preserves_accepted_edits_until_restore(session, note_document):
    document = note_document
    access = document.access
    operations = NoteOperations(session, MagicMock(), document.indexer)
    await operations.delete(access.member_id, access.org_id, document.key[1])

    outcome = await persist_snapshot(*document.key, access.org_id, b"", b"")
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
        await accept_update(
            document.key,
            access.org_id,
            access.member_id,
            document.accepted.generation,
            denied.get_update(),
        )

    await operations.restore(access.member_id, access.org_id, document.key[1])
    outcome = await persist_snapshot(*document.key, access.org_id, b"", b"")
    assert outcome is SnapshotOutcome.RENDERED
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
        note = await db.get(Note, document.key[1])
        assert not note.is_deleted
        assert note.content == BASE_CONTENT + ACCEPTED_SUFFIX
        assert snapshot.generation == document.accepted.generation
        assert snapshot.rendered_revision == snapshot.revision


async def test_unchanged_projection_preserves_content_version_and_timestamp(note_document):
    document = note_document
    await persist_snapshot(*document.key, document.access.org_id, b"", b"")
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        version, updated_at = note.version, note.updated_at
        snapshot = await load_snapshot(db, document.key)
        snapshot.rendered_revision = 0
        await db.commit()
    await persist_snapshot(*document.key, document.access.org_id, b"", b"")
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        assert (note.version, note.updated_at) == (version, updated_at)
        assert snapshot.rendered_revision == snapshot.revision


async def test_recovery_projects_new_content_while_search_is_unavailable(note_document, monkeypatch):
    document = note_document
    org_id = document.access.org_id

    def scoped_select(*entities):
        return select(*entities).where(RealtimeYjsSnapshot.organization_id == org_id)

    monkeypatch.setattr(jobs, "select", scoped_select)
    with patch(
        "uniffy.domains.notes.projection.NoteProjectionOperations._index_for_search",
        AsyncMock(side_effect=OSError("search unavailable")),
    ):
        with pytest.raises(OSError):
            await persist_snapshot(*document.key, org_id, b"", b"")
        doc = decode_snapshot(document.accepted)
        markdown_text(doc).insert(0, "latest ")
        await accept_update(
            document.key,
            org_id,
            document.access.member_id,
            document.accepted.generation,
            doc.get_update(),
        )
        await jobs.recover_realtime_projections({})
    async with open_session() as db:
        note = await db.get(Note, document.key[1])
        snapshot = await load_snapshot(db, document.key)
        assert note.content == "latest " + BASE_CONTENT + ACCEPTED_SUFFIX
        assert snapshot.rendered_revision == snapshot.revision
        assert snapshot.effects_pending


async def test_restore_waits_for_document_transaction(session, note_document):
    document = note_document
    access = document.access
    await session.execute(update(Note).where(Note.id == document.key[1]).values(is_deleted=True))
    await session.commit()

    async def restore():
        async with open_session() as db:
            operations = NoteOperations(db, MagicMock(), document.indexer)
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
    operations = NoteOperations(session, MagicMock(), document.indexer)
    await operations.delete(access.member_id, access.org_id, document.key[1])
    await persist_snapshot(*document.key, access.org_id, b"", b"")
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
    await accept_update(
        document.key,
        access.org_id,
        access.member_id,
        document.accepted.generation,
        doc.get_update(),
    )
    assert await persist_snapshot(*document.key, access.org_id, b"", b"") is SnapshotOutcome.RENDERED
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


@pytest.mark.parametrize("deferred", [False, True])
async def test_recovery_batch_advances_past_unrenderable_rows(
    session, access, monkeypatch, deferred
):
    ids = [generate_id() for _ in range(3)]
    oldest = datetime(2000, 1, 1, tzinfo=UTC)
    for index, content_id in enumerate(ids):
        session.add(
            RealtimeYjsSnapshot(
                content_type=ContentType.NOTE,
                content_id=content_id,
                organization_id=access.org_id,
                revision=1,
                rendered_revision=0,
                state_vector=b"",
                updates=b"",
                updated_at=oldest + timedelta(seconds=index),
            )
        )
    await session.commit()

    # Scope the production selection to fixture rows without touching other tenant work.
    def scoped_select(*entities):
        return select(*entities).where(RealtimeYjsSnapshot.organization_id == access.org_id)

    attempts = []

    async def render(content_type, content_id, organization_id, *args):
        attempts.append(content_id)
        if content_id in ids[:2]:
            if deferred:
                return SnapshotOutcome.SNAPSHOT_ONLY
            raise ValueError("Invalid projection data")
        async with open_session() as db:
            snapshot = await load_snapshot(db, (content_type, content_id))
            snapshot.rendered_revision = snapshot.revision
            await db.commit()
        return SnapshotOutcome.RENDERED

    monkeypatch.setattr(jobs, "select", scoped_select)
    monkeypatch.setattr(jobs, "RECOVERY_BATCH_SIZE", 2)
    monkeypatch.setattr(jobs, "persist_snapshot", render)
    try:
        await jobs.recover_realtime_projections({})
        assert set(attempts) == set(ids[:2])
        await jobs.recover_realtime_projections({})
        assert ids[2] in attempts
        async with open_session() as db:
            snapshot = await load_snapshot(db, (ContentType.NOTE, ids[2]))
            assert snapshot.rendered_revision == snapshot.revision
    finally:
        await session.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id.in_(ids))
        )
        await session.commit()
