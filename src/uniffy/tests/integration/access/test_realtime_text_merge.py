"""Plain description and content writes merge into the live realtime generation."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import StaleContentVersionError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.storage import (
    accept_update,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

LIVE = "base human"
MERGED = "base human agent"


@pytest.fixture(autouse=True)
def adapters() -> None:
    register_realtime_adapter(TaskRealtimeAdapter(MagicMock()))
    register_realtime_adapter(EventRealtimeAdapter(MagicMock()))
    register_realtime_adapter(NoteRealtimeAdapter(MagicMock()))


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


async def test_task_description_write_merges_into_live_generation(
    session: AsyncSession, access: SimpleNamespace, task_document: SimpleNamespace
) -> None:
    client = await _type_live(task_document, access)
    content = TaskContentOperations(session, search_indexer=AsyncMock())
    with (
        patch.object(content, "_index_for_search", new_callable=AsyncMock) as index,
        patch(
            "uniffy.domains.projects.tasks.mutations.publish_content_replace",
            new_callable=AsyncMock,
        ) as publish,
    ):
        task, _ = await TaskMutationOperations(session, content).update(
            access.member_id, access.org_id, task_document.row.id, description="base agent"
        )
    assert task.description == MERGED
    assert index.await_args.args[0].description == MERGED
    publish.assert_awaited_once_with(*task_document.key, MERGED)
    await _assert_merged_snapshot(task_document, access.member_id)
    await _assert_same_generation_update_accepted(task_document, access, client)


async def test_event_description_write_merges_into_live_generation(
    session: AsyncSession, access: SimpleNamespace, event_document: SimpleNamespace
) -> None:
    client = await _type_live(event_document, access)
    operations = CalendarEventOperations(session, MagicMock())
    with (
        patch.object(operations, "_index_for_search", new_callable=AsyncMock) as index,
        patch(
            "uniffy.domains.scheduling.calendar.events.updates.publish_content_replace",
            new_callable=AsyncMock,
        ) as publish,
    ):
        event = await operations.update(
            access.member_id,
            access.org_id,
            event_document.row.id,
            description="base agent",
            call_lifecycle=MagicMock(),
        )
    assert event.description == MERGED
    assert index.await_args.args[0].description == MERGED
    publish.assert_awaited_once_with(*event_document.key, MERGED)
    await _assert_merged_snapshot(event_document, access.member_id)
    await _assert_same_generation_update_accepted(event_document, access, client)


async def test_note_content_write_without_version_merges_into_live_generation(
    session: AsyncSession, access: SimpleNamespace, note_document: SimpleNamespace
) -> None:
    client = await _type_live(note_document, access)
    operations = NoteOperations(session, MagicMock(), AsyncMock())
    with (
        patch.object(operations, "_index_for_search", new_callable=AsyncMock) as index,
        patch(
            "uniffy.domains.notes.content.updates.publish_content_replace",
            new_callable=AsyncMock,
        ) as publish,
        patch(
            "uniffy.domains.notes.content.updates.reconcile_inline_attachments",
            new_callable=AsyncMock,
        ),
        patch("uniffy.domains.notes.content.updates.emit_notification", new_callable=AsyncMock),
    ):
        note = await operations.update(
            access.member_id, access.org_id, note_document.row.id, content="base agent"
        )
    assert note.content == MERGED
    assert index.await_args.args[0].content == MERGED
    publish.assert_awaited_once_with(*note_document.key, MERGED)
    await _assert_merged_snapshot(note_document, access.member_id)
    await _assert_same_generation_update_accepted(note_document, access, client)


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
