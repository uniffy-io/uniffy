import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import Update, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.converters.common_proto import CONTENT_TYPE_TO_PROTO
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import RealtimeRenderConflict, register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.state import ClientHandle, YDocSession
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot, lock_document, stage_seed
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    EventVisibility,
    SubjectType,
    generate_id,
)
from uniffy.domains.notifications.content import project_content_change
from uniffy.domains.projects.defaults import stage_default_project_fields
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.domains.projects.tasks.realtime import TaskRealtimePersistence
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.events.realtime import EventRealtimePersistence
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def cleanup_realtime_rows(session: AsyncSession, access: SimpleNamespace):
    register_realtime_adapter(TaskRealtimeAdapter(MagicMock()))
    register_realtime_adapter(EventRealtimeAdapter(MagicMock()))
    yield
    await session.rollback()
    for content_type, model in (
        (ContentType.TASK, Task),
        (ContentType.CALENDAR_EVENT, CalendarEvent),
    ):
        await session.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_type == content_type,
                RealtimeYjsSnapshot.content_id.in_(
                    select(model.id).where(model.organization_id == access.org_id)
                ),
            )
        )
    await session.execute(
        delete(FieldDefinition).where(
            FieldDefinition.project_id.in_(
                select(Project.id).where(Project.organization_id == access.org_id)
            )
        )
    )
    await session.commit()


async def _private_event(
    session: AsyncSession, access: SimpleNamespace
) -> tuple[CalendarEvent, ContentMember]:
    calendar = Calendar(organization_id=access.org_id, owner_id=access.member_id, name="Realtime")
    session.add(calendar)
    await session.flush()
    now = datetime.now(UTC)
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Private agenda",
        description="Secret agenda",
        start_time=now,
        end_time=now + timedelta(hours=1),
        visibility=EventVisibility.PRIVATE,
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    session.add(event)
    await session.flush()
    grant = ContentMember(
        organization_id=access.org_id,
        content_type=ContentType.CALENDAR_EVENT,
        content_id=event.id,
        subject_type=SubjectType.USER,
        subject_id=access.peer_id,
        role=ContentRole.EDITOR,
        added_by_user_id=access.member_id,
    )
    session.add(grant)
    await session.commit()
    return event, grant


async def test_private_event_downgrade_closes_live_non_attendee(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    event, grant = await _private_event(session, access)
    adapter = EventRealtimeAdapter(MagicMock())
    assert (
        await adapter.authorize(session, access.peer_id, access.org_id, event.id)
        is ContentRole.EDITOR
    )
    grant.role = ContentRole.VIEWER
    session.add(grant)
    await session.commit()
    assert await adapter.authorize(session, access.peer_id, access.org_id, event.id) is None
    assert (
        await adapter.authorize(session, access.member_id, access.org_id, event.id)
        is ContentRole.OWNER
    )

    key = ContentType.CALENDAR_EVENT, event.id
    handle = ClientHandle(
        conn_id=1,
        user_id=access.peer_id,
        can_edit=True,
        token_version=0,
        ws=MagicMock(),
        doc_key=key,
    )
    manager = YDocManager()
    manager._sessions[key] = YDocSession(
        key=key, ydoc=pycrdt.Doc(), organization_id=access.org_id, clients={1: handle}
    )
    with (
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
        patch.object(manager, "_close_handle", new_callable=AsyncMock) as close,
    ):
        await manager._reauthorize_docs((key,), None)
    close.assert_awaited_once_with(handle, 4403, "access revoked")


async def test_attendee_removal_retains_independent_editor_grant(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    event, grant = await _private_event(session, access)
    attendee = EventAttendee(event_id=event.id, user_id=access.peer_id)
    session.add(attendee)
    await session.commit()
    adapter = EventRealtimeAdapter(MagicMock())
    grant.role = ContentRole.VIEWER
    session.add(grant)
    await session.commit()
    assert (
        await adapter.authorize(session, access.peer_id, access.org_id, event.id)
        is ContentRole.VIEWER
    )
    grant.role = ContentRole.EDITOR
    session.add(grant)
    await session.execute(delete(EventAttendee).where(EventAttendee.id == attendee.id))
    await session.commit()
    assert (
        await adapter.authorize(session, access.peer_id, access.org_id, event.id)
        is ContentRole.EDITOR
    )
    await session.delete(grant)
    await session.commit()
    assert await adapter.authorize(session, access.peer_id, access.org_id, event.id) is None


@pytest.mark.parametrize("races", [1, 3])
async def test_task_render_contends_with_metadata_write(
    session: AsyncSession, access: SimpleNamespace, races: int
) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Realtime project",
        slug=f"rt-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Task",
        number=1,
        description="Initial",
    )
    session.add(task)
    await session.commit()
    original_execute = session.execute
    remaining = races

    async def contend(statement, *args, **kwargs):
        nonlocal remaining
        if isinstance(statement, Update) and remaining:
            remaining -= 1
            async with open_session() as peer:
                await peer.execute(
                    update(Task)
                    .where(Task.id == task.id)
                    .values(title="Changed metadata", version=Task.version + 1)
                )
                await peer.commit()
        return await original_execute(statement, *args, **kwargs)

    with (
        patch.object(session, "execute", side_effect=contend),
        patch(
            "uniffy.domains.projects.tasks.realtime.TaskContentOperations._index_for_search",
            new_callable=AsyncMock,
        ),
        patch(
            "uniffy.domains.projects.tasks.realtime.TaskNotifications.emit_mention_notifications",
            new_callable=AsyncMock,
        ),
    ):
        persistence = TaskRealtimePersistence(session, MagicMock())
        if races == 3:
            with pytest.raises(RealtimeRenderConflict):
                await persistence.save(access.org_id, task.id, "Merged description")
        else:
            await persistence.save(access.org_id, task.id, "Merged description")
    stored = (
        await original_execute(
            select(Task).where(Task.id == task.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored.title == "Changed metadata"
    assert stored.description == ("Initial" if races == 3 else "Merged description")
    assert stored.version == 1 + races + (races == 1)


async def test_event_render_preserves_metadata_and_only_notifies_new_mentions(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    event, _ = await _private_event(session, access)
    session.add(EventAttendee(event_id=event.id, user_id=access.peer_id))
    await session.commit()
    initial = (event.title, event.start_time, event.end_time, event.ical_sequence)
    description = " ".join(
        f"[[[Person|urn:uniffy:content:USER:{user_id}]]]"
        for user_id in (access.member_id, access.peer_id, access.admin_id)
    )
    with (
        patch(
            "uniffy.domains.scheduling.calendar.events.realtime.EventContentOperations._index_for_search",
            new_callable=AsyncMock,
        ) as index,
        patch(
            "uniffy.domains.scheduling.calendar.events.notifications.emit_notification",
            new_callable=AsyncMock,
        ) as notify,
    ):
        persistence = EventRealtimePersistence(session, MagicMock())
        await persistence.save(access.org_id, event.id, description)
        assert notify.await_args.args[0].target_user_ids == [access.admin_id]
        await persistence.save(access.org_id, event.id, description)
        notify.assert_awaited_once()
        assert index.await_count == 2
    await session.refresh(event)
    assert event.description == description
    assert len(event.outgoing_references) == 3
    assert (event.title, event.start_time, event.end_time, event.ical_sequence) == initial
    assert await persistence.save(generate_id(), event.id, "Wrong tenant") is None
    event.is_deleted = True
    await session.commit()
    assert await persistence.save(access.org_id, event.id, "Deleted") is None


async def _seeded(session: AsyncSession, key, organization_id) -> SimpleNamespace:
    """Seed the shared document; return scalars, since the row object itself is what mutates."""
    await lock_document(session, key)
    seed = await stage_seed(session, key, organization_id)
    await session.commit()
    return SimpleNamespace(generation=seed.generation, revision=seed.revision)


@pytest.mark.parametrize("description", [None, "RPC replacement"])
async def test_event_update_merges_only_description_into_snapshot(
    session: AsyncSession, access: SimpleNamespace, description: str | None
) -> None:
    event, _ = await _private_event(session, access)
    key = ContentType.CALENDAR_EVENT, event.id
    seed = await _seeded(session, key, access.org_id)
    operations = CalendarEventOperations(session, MagicMock())
    with (
        patch.object(operations, "_index_for_search", new_callable=AsyncMock),
        patch(
            "uniffy.domains.scheduling.calendar.events.updates.publish_content_replace",
            new_callable=AsyncMock,
        ) as publish,
    ):
        await operations.update(
            access.member_id,
            access.org_id,
            event.id,
            description=description,
            call_lifecycle=MagicMock(),
        )
    snapshot = await load_snapshot(session, key)
    assert snapshot is not None
    assert snapshot.generation == seed.generation
    if description is None:
        assert snapshot.revision == seed.revision
        publish.assert_not_awaited()
        await session.delete(snapshot)
        await session.commit()
    else:
        assert str(markdown_text(decode_snapshot(snapshot))) == description
        assert snapshot.revision == snapshot.rendered_revision == seed.revision + 1
        publish.assert_awaited_once_with(*key, description)


@pytest.mark.parametrize("description", [None, "RPC replacement"])
async def test_task_update_merges_only_description_into_snapshot(
    session: AsyncSession, access: SimpleNamespace, description: str | None
) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Realtime project",
        slug=f"rt-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(project)
    await session.flush()
    await stage_default_project_fields(session, project.id)
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Task",
        number=1,
        description="Initial",
    )
    session.add(task)
    await session.commit()
    key = ContentType.TASK, task.id
    seed = await _seeded(session, key, access.org_id)
    content = TaskContentOperations(session, search_indexer=MagicMock())
    with (
        patch.object(content, "_index_for_search", new_callable=AsyncMock),
        patch(
            "uniffy.domains.projects.tasks.mutations.publish_content_replace",
            new_callable=AsyncMock,
        ) as publish,
    ):
        fields = {} if description is None else {"description": description}
        await TaskMutationOperations(session, content).update(
            access.member_id,
            access.org_id,
            task.id,
            **fields,
        )
    snapshot = await load_snapshot(session, key)
    assert snapshot is not None
    assert snapshot.generation == seed.generation
    if description is None:
        assert snapshot.revision == seed.revision
        publish.assert_not_awaited()
        await session.delete(snapshot)
        await session.commit()
    else:
        assert str(markdown_text(decode_snapshot(snapshot))) == description
        assert snapshot.revision == snapshot.rendered_revision == seed.revision + 1
        publish.assert_awaited_once_with(*key, description)


async def test_description_hint_checks_current_project_access(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Hint project",
        slug=f"hint-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Hint task",
        number=1,
        description="Initial",
    )
    session.add(task)
    await session.commit()
    payload = {
        "content_type": int(CONTENT_TYPE_TO_PROTO[ContentType.TASK]),
        "content_id": str(task.id),
    }
    recipients = [access.member_id, access.admin_id, access.peer_id, access.outsider_id]
    results = await asyncio.gather(
        *(
            project_content_change(payload, actor, access.org_id, open_session)
            for actor in recipients
        )
    )
    assert [result is not None for result in results] == [True, False, False, False]
    assert (
        await project_content_change(payload, access.member_id, access.org_id, open_session)
        is not None
    )
    assert (
        await project_content_change(payload, access.admin_id, access.org_id, open_session) is None
    )
    assert (
        await project_content_change(payload, access.member_id, generate_id(), open_session) is None
    )
    grant = ContentMember(
        organization_id=access.org_id,
        content_type=ContentType.PROJECT,
        content_id=project.id,
        subject_type=SubjectType.USER,
        subject_id=access.peer_id,
        role=ContentRole.VIEWER,
        added_by_user_id=access.member_id,
    )
    session.add(grant)
    await session.commit()
    assert (
        await project_content_change(payload, access.peer_id, access.org_id, open_session)
        is not None
    )
    grant.role = ContentRole.BLOCKED
    session.add(grant)
    await session.commit()
    assert await project_content_change(payload, access.peer_id, access.org_id, open_session) is None


async def test_calendar_audience_keeps_attendee_blocks_and_private_details(
    session: AsyncSession,
    access: SimpleNamespace,
) -> None:
    event, grant = await _private_event(session, access)
    adapter = EventRealtimeAdapter(MagicMock())
    actors = access.user_ids

    async def compare():
        roles = await adapter.authorize_many(session, actors, access.org_id, event.id)
        for actor in actors:
            assert roles[actor] == await adapter.authorize(session, actor, access.org_id, event.id)
        return roles

    assert (await compare())[access.peer_id] == ContentRole.EDITOR
    grant.role = ContentRole.VIEWER
    session.add(grant)
    await session.commit()
    assert (await compare())[access.peer_id] is None
    session.add(EventAttendee(event_id=event.id, user_id=access.peer_id))
    await session.commit()
    assert (await compare())[access.peer_id] == ContentRole.VIEWER
    grant.role = ContentRole.BLOCKED
    session.add(grant)
    await session.commit()
    assert (await compare())[access.peer_id] is None


@pytest.mark.parametrize("content_type", [ContentType.TASK, ContentType.CALENDAR_EVENT])
async def test_projection_hint_follows_committed_description(
    session: AsyncSession, access: SimpleNamespace, content_type: ContentType
) -> None:
    if content_type == ContentType.CALENDAR_EVENT:
        row, _grant = await _private_event(session, access)
        persistence = EventRealtimePersistence(session, MagicMock())
        module = "uniffy.domains.scheduling.calendar.events.realtime"
        operations = "EventContentOperations"
        notifications = "EventNotifications"
    else:
        project = Project(
            organization_id=access.org_id,
            owner_id=access.member_id,
            name="Committed hint",
            slug=f"hint-{generate_id().hex[-12:]}",
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(project)
        await session.flush()
        row = Task(
            organization_id=access.org_id,
            project_id=project.id,
            owner_id=access.member_id,
            title="Committed hint task",
            number=1,
            description="Initial",
        )
        session.add(row)
        await session.commit()
        persistence = TaskRealtimePersistence(session, MagicMock())
        module = "uniffy.domains.projects.tasks.realtime"
        operations = "TaskContentOperations"
        notifications = "TaskNotifications"
    observed = []

    async def published(kind, content_id, organization_id):
        async with open_session() as reader:
            stored = await reader.get(type(row), content_id)
            observed.append((kind, organization_id, stored.description))

    with (
        patch(f"{module}.publish_content_changed", side_effect=published),
        patch(f"{module}.{operations}._index_for_search", new_callable=AsyncMock),
        patch(f"{module}.{notifications}.emit_mention_notifications", new_callable=AsyncMock),
    ):
        staged = await persistence.stage_save(access.org_id, row.id, "Committed preview")
        assert observed == []
        await session.commit()
        await staged[1]()
    assert observed == [(content_type, access.org_id, "Committed preview")]
