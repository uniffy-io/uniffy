"""Plain description and content writes merge into the live realtime generation."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import StaleContentVersionError, ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.live import (
    TextMerge,
    has_unprojected_content,
    load_live_document,
    stage_text_merge,
)
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import (
    accept_update,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.types import (
    AccessMode,
    ContentType,
    RecurrenceEditScope,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    doc_messages,  # noqa: F401 - fixture
    doc_subscription,
    establish,
    live_note,  # noqa: F401 - fixture
    published_progress,
    published_replacements,
    stored,
    text_of,
    typed,
    unreachable_buffer,  # noqa: F401 - fixture
    valkey,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

LIVE = "base human"
MERGED = "base human agent"


@pytest.fixture(autouse=True)
def adapters() -> None:
    register_realtime_adapter(TaskRealtimeAdapter(AsyncMock()))
    register_realtime_adapter(EventRealtimeAdapter(AsyncMock()))
    register_realtime_adapter(NoteRealtimeAdapter(AsyncMock()))


async def _seeded(session: AsyncSession, key, organization_id) -> SimpleNamespace:
    """Seed the shared document; return scalars, since the row object itself is what mutates."""
    await lock_document(session, key)
    seed = await stage_seed(session, key, organization_id)
    await session.commit()
    return SimpleNamespace(generation=seed.generation, revision=seed.revision, updates=seed.updates)


async def _type_live(document: SimpleNamespace, access: SimpleNamespace):
    """Accept one client edit the way a keystroke arrives; projection has not run."""
    client = decode_snapshot(document.seed)
    before = client.get_state()
    markdown_text(client).insert(len("base"), " human")
    await accept_update(
        document.key,
        access.org_id,
        access.member_id,
        document.seed.generation,
        client.get_update(before),
    )
    return client


async def _assert_merged_snapshot(document: SimpleNamespace, actor_id) -> None:
    async with open_session() as db:
        snapshot = await load_snapshot(db, document.key)
    assert snapshot is not None
    assert str(markdown_text(decode_snapshot(snapshot))) == MERGED
    assert snapshot.generation == document.seed.generation
    assert snapshot.revision == 2
    assert snapshot.rendered_revision == 2
    assert snapshot.actor_id == actor_id


async def _assert_same_generation_update_accepted(
    document: SimpleNamespace, access: SimpleNamespace, client
) -> None:
    before = client.get_state()
    markdown_text(client).insert(len(LIVE), " more")
    accepted = await accept_update(
        document.key,
        access.org_id,
        access.member_id,
        document.seed.generation,
        client.get_update(before),
    )
    text = str(markdown_text(decode_snapshot(accepted)))
    assert text.startswith("base human")
    assert "agent" in text and "more" in text


@pytest_asyncio.fixture(loop_scope="session")
async def task_document(session: AsyncSession, access: SimpleNamespace):
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Merge",
        access_mode=AccessMode.OWNER_ONLY,
        slug=f"merge-{generate_id().hex[-12:]}",
    )
    session.add(project)
    await session.flush()
    await stage_default_project_fields(session, project.id)
    task = Task(
        organization_id=access.org_id,
        owner_id=access.member_id,
        project_id=project.id,
        title="Merge",
        number=1,
        description="base",
    )
    session.add(task)
    await session.commit()
    key = ContentType.TASK, task.id
    seed = await _seeded(session, key, access.org_id)
    project_id = project.id
    yield SimpleNamespace(key=key, seed=seed, row=task)
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
    )
    await session.execute(delete(Task).where(Task.id == key[1]))
    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))
    await session.execute(delete(Project).where(Project.id == project_id))
    await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def event_document(session: AsyncSession, access: SimpleNamespace):
    calendar = Calendar(organization_id=access.org_id, owner_id=access.member_id, name="Merge")
    session.add(calendar)
    await session.flush()
    now = datetime.now(UTC)
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Merge",
        description="base",
        start_time=now,
        end_time=now + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(event)
    await session.commit()
    key = ContentType.CALENDAR_EVENT, event.id
    seed = await _seeded(session, key, access.org_id)
    yield SimpleNamespace(key=key, seed=seed, row=event)
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
    )
    await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def note_document(session: AsyncSession, access: SimpleNamespace):
    note = Note(
        organization_id=access.org_id,
        owner_id=access.member_id,
        title="Merge",
        slug=f"merge-{generate_id().hex}",
        content="base",
    )
    session.add(note)
    await session.commit()
    key = ContentType.NOTE, note.id
    seed = await _seeded(session, key, access.org_id)
    yield SimpleNamespace(key=key, seed=seed, row=note)
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
    )
    await session.execute(delete(Note).where(Note.id == key[1]))
    await session.commit()


async def _column(document: SimpleNamespace) -> str | None:
    """The domain column a plain write stored, read outside the writer's session."""
    kind, content_id = document.key
    model = {ContentType.TASK: Task, ContentType.CALENDAR_EVENT: CalendarEvent}.get(kind)
    async with open_session() as db:
        if model is None:
            return await db.scalar(select(Note.content).where(Note.id == content_id))
        return await db.scalar(select(model.description).where(model.id == content_id))


@pytest.mark.parametrize("projected", [False, True])
async def test_plain_write_merges_into_live_generation_and_tells_resident_replicas(
    session: AsyncSession, access: SimpleNamespace, document: SimpleNamespace, projected: bool
) -> None:
    client = await _type_live(document, access)
    if projected:
        await _project(document, access)

    async with doc_subscription(document.key) as messages:
        with patch("uniffy.domains.notes.content.updates.emit_notification", new_callable=AsyncMock):
            row = await _write(session, access, document, **_fields(document, "base agent"))
        replacements = await published_replacements(messages)

    assert getattr(row, next(iter(_fields(document, "")))) == MERGED
    assert await _column(document) == MERGED
    assert replacements == [MERGED]
    await _assert_merged_snapshot(document, access.member_id)
    await _assert_same_generation_update_accepted(document, access, client)


async def test_note_content_write_with_version_still_rejects_unprojected_edits(
    session: AsyncSession, access: SimpleNamespace, note_document: SimpleNamespace
) -> None:
    await _type_live(note_document, access)
    operations = NoteOperations(session, MagicMock(), AsyncMock())
    with pytest.raises(StaleContentVersionError):
        await operations.update(
            access.member_id,
            access.org_id,
            note_document.row.id,
            content="agent replacement",
            expected_content_version=note_document.row.version,
        )
    await session.rollback()
    async with open_session() as db:
        snapshot = await load_snapshot(db, note_document.key)
    assert str(markdown_text(decode_snapshot(snapshot))) == LIVE
    assert snapshot.generation == note_document.seed.generation


async def _project(document: SimpleNamespace, access: SimpleNamespace) -> None:
    outcome = await persist_snapshot(*document.key, access.org_id, b"", b"")
    assert outcome == SnapshotOutcome.RENDERED


async def _write(session, access, document, **fields):
    kind, content_id = document.key
    if kind == ContentType.TASK:
        content = TaskContentOperations(session, search_indexer=AsyncMock())
        row, _ = await TaskMutationOperations(session, content).update(
            access.member_id, access.org_id, content_id, **fields
        )
        return row
    if kind == ContentType.CALENDAR_EVENT:
        return await CalendarEventOperations(session, AsyncMock()).update(
            access.member_id, access.org_id, content_id, call_lifecycle=MagicMock(), **fields
        )
    return await NoteOperations(session, MagicMock(), AsyncMock()).update(
        access.member_id, access.org_id, content_id, **fields
    )


@pytest.fixture(params=["task_document", "event_document", "note_document"])
def document(request):
    return request.getfixturevalue(request.param)


def _fields(document, text, *, with_base=True):
    field = "content" if document.key[0] == ContentType.NOTE else "description"
    fields = {field: text}
    if with_base:
        fields[f"base_{field}"] = "base"
    return fields


async def test_no_snapshot_preserves_concurrent_plain_write(session, access, document):
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == document.key[1])
    )
    await session.commit()
    async with open_session() as db:
        await _write(db, access, document, **_fields(document, LIVE))
    row = await _write(session, access, document, **_fields(document, "base agent"))
    assert getattr(row, next(iter(_fields(document, "")))) == MERGED
    assert await load_snapshot(session, document.key) is None


@pytest.mark.parametrize("projected", [False, True])
async def test_missing_base_rejects_entire_write(session, access, document, projected):
    await _type_live(document, access)
    if projected:
        await _project(document, access)
    with pytest.raises(ValidationError, match="Original content"):
        await _write(
            session, access, document, title="Changed", **_fields(document, "base", with_base=False)
        )
    await session.rollback()
    await session.refresh(document.row)
    assert document.row.title == "Merge"
    snapshot = await load_snapshot(session, document.key)
    assert str(markdown_text(decode_snapshot(snapshot))) == LIVE


async def test_metadata_write_preserves_peer_text(session, access, document):
    await _type_live(document, access)
    await _project(document, access)
    row = await _write(session, access, document, title="Changed")
    assert row.title == "Changed"
    assert getattr(row, next(iter(_fields(document, "")))) == LIVE
    snapshot = await load_snapshot(session, document.key)
    assert str(markdown_text(decode_snapshot(snapshot))) == LIVE


@pytest.mark.parametrize(
    "scope", [RecurrenceEditScope.THIS_EVENT, RecurrenceEditScope.THIS_AND_FOLLOWING]
)
@pytest.mark.parametrize("edit_description", [False, True])
async def test_scoped_event_copy_preserves_unprojected_text(
    session, access, event_document, scope, edit_description
):
    await _type_live(event_document, access)
    event_document.row.recurrence_pattern = RecurrencePattern.DAILY
    await session.commit()
    fields = _fields(event_document, "base agent") if edit_description else {}
    row = await _write(
        session,
        access,
        event_document,
        title="Occurrence",
        recurrence_edit_scope=scope,
        occurrence_date=(event_document.row.start_time + timedelta(days=1)).date(),
        **fields,
    )
    assert row.description == (MERGED if edit_description else LIVE)
    assert row.id != event_document.key[1]
    snapshot = await load_snapshot(session, event_document.key)
    assert str(markdown_text(decode_snapshot(snapshot))) == LIVE


async def _merge(note: BufferedDocument, *, base: str, incoming: str) -> TextMerge:
    async with open_session() as db:
        await lock_document(db, note.key, note.org)
        merge = await stage_text_merge(
            note.buffer,
            db,
            note.key,
            note.org,
            note.owner,
            base=base,
            stored=base,
            incoming=incoming,
        )
        await db.commit()
    await merge.after_commit()
    return merge


async def test_stale_base_write_merges_with_buffered_edits_and_covers_them(
    live_note: BufferedDocument, doc_messages
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    await live_note.admit("u-bob", typed(live_note.base, alice, suffix=" Bob"), live_note.peer)
    before = await stored(live_note.key)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        merge = await stage_text_merge(
            live_note.buffer,
            db,
            live_note.key,
            live_note.org,
            live_note.owner,
            base="base",
            stored="base",
            incoming="base agent",
        )
        await db.commit()
    uncleaned = await live_note.stream_ids()
    await merge.after_commit()

    assert merge.text == "base Alice Bob agent"
    assert uncleaned == [b"1-0", b"2-0"]
    row = await stored(live_note.key)
    assert text_of(row.updates) == merge.text
    assert (row.checkpoint_seq, row.revision, row.rendered_revision, row.actor_id) == (
        2,
        before.revision + 1,
        before.revision + 1,
        live_note.owner,
    )
    assert (row.generation, row.buffer_epoch) == (live_note.generation, live_note.head.scope.epoch)
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 1,
        "receipts": [],
        "due": None,
    }
    assert await published_progress(doc_messages) == [
        {
            "generation": live_note.generation,
            "epoch": live_note.head.scope.epoch,
            "covered_sequence": 2,
            "checkpoint_revision": row.revision,
        }
    ]


async def test_append_arriving_during_a_merge_survives_its_cleanup(
    live_note: BufferedDocument,
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        merge = await stage_text_merge(
            live_note.buffer,
            db,
            live_note.key,
            live_note.org,
            live_note.owner,
            base="base",
            stored="base",
            incoming="base agent",
        )
        # Another process appends while this transaction still holds the staged checkpoint.
        await live_note.admit("u-carol", typed(live_note.base, alice, suffix=" Carol"))
        await db.commit()
    await merge.after_commit()

    row = await stored(live_note.key)
    assert row.checkpoint_seq == 1
    assert text_of(row.updates) == "base Alice agent"
    state = await live_note.buffer_state()
    assert (state["stream"], state["receipts"]) == ([b"2-0"], [b"u-carol"])
    assert state["due"] is not None
    async with open_session() as db:
        live = await load_live_document(live_note.buffer, db, live_note.key)
    assert live is not None
    assert live.text() in {"base Alice agent Carol", "base Alice Carol agent"}

    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert (result.status, result.covered) == (CheckpointStatus.COMMITTED, 2)
    assert await live_note.stream_ids() == []


async def test_failed_write_after_a_staged_merge_leaves_row_and_buffer_intact(
    live_note: BufferedDocument,
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    await live_note.admit("u-bob", typed(live_note.base, alice, suffix=" Bob"), live_note.peer)
    before = await stored(live_note.key)
    buffered = await live_note.buffer_state()

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        await stage_text_merge(
            live_note.buffer,
            db,
            live_note.key,
            live_note.org,
            live_note.owner,
            base="base",
            stored="base",
            incoming="base agent",
        )
        # A later domain write in the same transaction fails, so nothing of it may commit.
        db.add(
            Note(
                organization_id=generate_id(),
                owner_id=live_note.owner,
                title="Orphan",
                slug=f"orphan-{generate_id().hex}",
            )
        )
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()

    row = await stored(live_note.key)
    assert (row.updates, row.revision, row.rendered_revision, row.checkpoint_seq) == (
        before.updates,
        before.revision,
        before.rendered_revision,
        before.checkpoint_seq,
    )
    assert await live_note.buffer_state() == buffered
    async with open_session() as db:
        live = await load_live_document(live_note.buffer, db, live_note.key)
    assert live is not None and live.text() == "base Alice Bob"


async def test_expected_version_counts_a_buffered_tail_on_a_projected_row(
    live_note: BufferedDocument,
) -> None:
    async def unprojected() -> bool:
        async with open_session() as db:
            await lock_document(db, live_note.key, live_note.org)
            return await has_unprojected_content(live_note.buffer, db, live_note.key)

    assert not await unprojected()
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))
    row = await stored(live_note.key)

    assert row.revision == row.rendered_revision
    assert await unprojected()
    # A write that changes nothing still commits the tail, so the column catches up.
    assert (await _merge(live_note, base="base", incoming="base")).text == "base Alice"
    assert not await unprojected()


@pytest.mark.parametrize("loss", ["control_record", "instance_restart"])
async def test_merge_after_buffer_loss_moves_surviving_edits_to_a_fresh_epoch(
    live_note: BufferedDocument, doc_messages, loss: str
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    await live_note.admit("u-bob", typed(live_note.base, alice, suffix=" Bob"), live_note.peer)
    if loss == "control_record":
        await valkey().delete(live_note.keys.control)
    else:
        # The epoch was issued by an instance that has since restarted with its keys intact.
        async with open_session() as db:
            await db.execute(
                update(RealtimeYjsSnapshot)
                .where(RealtimeYjsSnapshot.content_id == live_note.key[1])
                .values(valkey_run_id="0" * 40)
            )
            await db.commit()

    merge = await _merge(live_note, base="base", incoming="base agent")

    row = await stored(live_note.key)
    assert merge.text == text_of(row.updates) == "base Alice Bob agent"
    assert row.generation == live_note.generation
    assert row.buffer_epoch not in (None, live_note.head.scope.epoch)
    assert row.checkpoint_seq == 0
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }
    assert await published_progress(doc_messages) == [
        {
            "generation": live_note.generation,
            "epoch": row.buffer_epoch,
            "covered_sequence": 0,
            "checkpoint_revision": row.revision,
        }
    ]
    fresh = await establish(live_note.buffer, live_note.key, live_note.org)
    assert (fresh.scope.epoch, fresh.head_seq) == (row.buffer_epoch, 0)


async def test_document_without_a_buffer_epoch_merges_while_valkey_is_unreachable(
    live_note: BufferedDocument, unreachable_buffer
) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(RealtimeYjsSnapshot.content_id == live_note.key[1])
            .values(buffer_epoch=None, valkey_run_id=None)
        )
        await db.commit()

    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        merge = await stage_text_merge(
            unreachable_buffer,
            db,
            live_note.key,
            live_note.org,
            live_note.owner,
            base="base",
            stored="base",
            incoming="base agent",
        )
        await db.commit()
    await merge.after_commit()

    row = await stored(live_note.key)
    assert merge.text == text_of(row.updates) == "base agent"
    assert (row.buffer_epoch, row.rendered_revision) == (None, row.revision)
