"""Task and event descriptions: access, renders, plain writes and the hints they publish."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from sqlalchemy import Update, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.converters.common_proto import CONTENT_TYPE_TO_PROTO
from uniffy.core.events.bus import event_from_json
from uniffy.core.events.realtime import NotificationPayloadType
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notifications.outbox import NotificationOutbox
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import (
    RealtimeRenderConflict,
    register_realtime_adapter,
)
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.publisher import RealtimePayloadKind
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot, lock_document, stage_seed
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    EventVisibility,
    RecurrencePattern,
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
from uniffy.domains.scheduling.calendar.search import refresh_event_search_projection
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.realtime_live import doc_subscription, published
from uniffy.tests.integration.access.recording_search import (
    RecordingSearchEngine,
    recording_indexer,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def cleanup_realtime_rows(session: AsyncSession, access: SimpleNamespace):
    register_realtime_adapter(TaskRealtimeAdapter(recording_indexer()))
    register_realtime_adapter(EventRealtimeAdapter(recording_indexer()))
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


@contextlib.asynccontextmanager
async def listening(channel: str) -> AsyncIterator[Any]:
    """Everything published on one channel from now on."""
    await init_pubsub()
    client = aioredis.from_url(ValkeyConfig.from_env().to_url())
    subscription = client.pubsub()
    await subscription.subscribe(channel)
    try:
        yield subscription
    finally:
        await subscription.aclose()
        await client.aclose()
        await close_pubsub()


async def changed(subscription: Any) -> list[str]:
    """Content ids announced as changed so far, oldest first."""
    return [
        payload["content_id"]
        for payload in await published(subscription)
        if payload.get("_type") == NotificationPayloadType.CONTENT_CHANGED
    ]


async def replacements(subscription: Any) -> int:
    """How many times the document channel told resident replicas to reload."""
    return sum(
        payload.get("kind") == RealtimePayloadKind.CONTENT_REPLACE
        for payload in await published(subscription)
    )


async def staged_mentions(
    session: AsyncSession, organization_id: UUID, urn: str
) -> list[tuple[UUID | None, list[UUID] | None]]:
    """Actor and recipients of each mention event staged for ``urn``, in staging order."""
    rows = await session.scalars(
        select(NotificationOutbox)
        .where(NotificationOutbox.organization_id == organization_id)
        .order_by(NotificationOutbox.attempted_at)
    )
    events = [event_from_json(row.payload) for row in rows]
    return [(event.actor_id, event.target_user_ids) for event in events if event.source_urn == urn]


def indexed(engine: RecordingSearchEngine, urn: str) -> bool:
    return any(document["urn"] == urn for document in engine.documents.values())


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


async def test_private_event_downgrade_leaves_a_non_attendee_no_access(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    event, grant = await _private_event(session, access)
    adapter = EventRealtimeAdapter(recording_indexer())
    assert (
        await adapter.authorize(session, access.peer_id, access.org_id, event.id)
        is ContentRole.EDITOR
    )
    grant.role = ContentRole.VIEWER
    session.add(grant)
    await session.commit()
    # Private details stay with attendees, so a viewer grant alone reads as no access at all.
    assert await adapter.authorize(session, access.peer_id, access.org_id, event.id) is None
    assert (
        await adapter.authorize(session, access.member_id, access.org_id, event.id)
        is ContentRole.OWNER
    )


async def test_attendee_removal_retains_independent_editor_grant(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    event, grant = await _private_event(session, access)
    attendee = EventAttendee(event_id=event.id, user_id=access.peer_id)
    session.add(attendee)
    await session.commit()
    adapter = EventRealtimeAdapter(recording_indexer())
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

    with patch.object(session, "execute", side_effect=contend):
        persistence = TaskRealtimePersistence(session, recording_indexer())
        if races == 3:
            with pytest.raises(RealtimeRenderConflict):
                await persistence.stage_save(access.org_id, task.id, "Merged description")
        else:
            await persistence.stage_save(access.org_id, task.id, "Merged description")
            await session.commit()
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
    engine = RecordingSearchEngine()
    persistence = EventRealtimePersistence(session, recording_indexer(engine))
    urn = build_content_urn(ContentType.CALENDAR_EVENT, event.id)
    mentions = []

    # The second, unchanged render still refreshes search but stages no mention.
    for _ in range(2):
        staged = await persistence.stage_save(access.org_id, event.id, description)
        assert staged is not None
        mentions.append(await staged_mentions(session, access.org_id, urn))
        # The shared worker delivers committed mentions; observing the staged row is enough.
        await session.execute(
            delete(NotificationOutbox).where(NotificationOutbox.organization_id == access.org_id)
        )
        await session.commit()
        engine.documents.clear()
        await staged[1]()
        assert indexed(engine, urn)
    assert mentions == [[(access.member_id, [access.admin_id])], []]
    await session.refresh(event)
    assert event.description == description
    assert len(event.outgoing_references) == 3
    assert (event.title, event.start_time, event.end_time, event.ical_sequence) == initial
    assert await persistence.stage_save(generate_id(), event.id, "Wrong tenant") is None
    event.is_deleted = True
    await session.commit()
    assert await persistence.stage_save(access.org_id, event.id, "Deleted") is None


@pytest.mark.parametrize("visibility", [EventVisibility.PRIVATE, EventVisibility.STANDARD])
async def test_event_projection_keeps_private_display_state_off_the_mention_channel(
    session: AsyncSession, access: SimpleNamespace, visibility: EventVisibility
) -> None:
    event, _ = await _private_event(session, access)
    event.visibility = visibility
    await session.commit()
    engine = RecordingSearchEngine()

    async with listening(f"mentions:{access.org_id}") as subscription:
        await refresh_event_search_projection(session, event, recording_indexer(engine))
        announced = [payload["urn"] for payload in await published(subscription)]

    assert indexed(engine, event.urn)
    assert announced == ([] if visibility == EventVisibility.PRIVATE else [event.urn])


async def _task(session: AsyncSession, access: SimpleNamespace) -> Task:
    """A task in the member's private project, so the member is the fallback author."""
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Render project",
        slug=f"render-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Render task",
        number=1,
        description="Initial",
    )
    session.add(task)
    await session.commit()
    return task


async def _rendered(
    session: AsyncSession, access: SimpleNamespace, content_type: ContentType
) -> tuple[Task | CalendarEvent, TaskRealtimePersistence | EventRealtimePersistence]:
    if content_type == ContentType.TASK:
        return await _task(session, access), TaskRealtimePersistence(session, recording_indexer())
    event, _ = await _private_event(session, access)
    return event, EventRealtimePersistence(session, recording_indexer())


@pytest.mark.parametrize("editor_known", [True, False], ids=["editor", "fallback"])
@pytest.mark.parametrize("content_type", [ContentType.TASK, ContentType.CALENDAR_EVENT])
async def test_render_attributes_a_new_mention_to_its_editor_or_the_owner(
    session: AsyncSession,
    access: SimpleNamespace,
    content_type: ContentType,
    editor_known: bool,
) -> None:
    row, persistence = await _rendered(session, access, content_type)
    content = f"Ask [[[Admin|urn:uniffy:content:USER:{access.admin_id}]]]"

    staged = await persistence.stage_save(
        access.org_id, row.id, content, actor_id=access.peer_id if editor_known else None
    )
    assert staged is not None
    mentions = await staged_mentions(session, access.org_id, build_content_urn(content_type, row.id))
    described = staged[0].description
    # Nothing commits, so the shared worker never sees the staged mention.
    await session.rollback()

    assert described == content
    author = access.peer_id if editor_known else access.member_id
    assert mentions == [(author, [access.admin_id])]


async def _occurrence(
    session: AsyncSession,
    access: SimpleNamespace,
    master_visibility: EventVisibility,
    override_visibility: EventVisibility,
) -> tuple[CalendarEvent, CalendarEvent]:
    """A daily series and one moved occurrence, both shared only through grants."""
    calendar = Calendar(organization_id=access.org_id, owner_id=access.member_id, name="Series")
    session.add(calendar)
    await session.flush()
    now = datetime.now(UTC)
    master = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Standup",
        description="Agenda",
        start_time=now,
        end_time=now + timedelta(minutes=30),
        visibility=master_visibility,
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        recurrence_pattern=RecurrencePattern.DAILY,
    )
    session.add(master)
    await session.flush()
    override = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Standup",
        description="Moved agenda",
        start_time=now + timedelta(days=1, hours=1),
        end_time=now + timedelta(days=1, hours=1, minutes=30),
        visibility=override_visibility,
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        recurrence_id=master.id,
    )
    session.add(override)
    await session.commit()
    return master, override


@pytest.mark.parametrize(
    ("master_visibility", "override_visibility", "role", "attends", "expected"),
    [
        (EventVisibility.STANDARD, EventVisibility.STANDARD, ContentRole.EDITOR, False, True),
        (EventVisibility.PRIVATE, EventVisibility.PRIVATE, ContentRole.VIEWER, False, False),
        (EventVisibility.PRIVATE, EventVisibility.STANDARD, ContentRole.VIEWER, False, False),
        (EventVisibility.PRIVATE, EventVisibility.PRIVATE, ContentRole.VIEWER, True, True),
    ],
    ids=["grant-on-occurrence", "not-attending", "private-master", "attending"],
)
async def test_occurrence_access_resolves_on_its_row_under_the_master_privacy_floor(
    session: AsyncSession,
    access: SimpleNamespace,
    master_visibility: EventVisibility,
    override_visibility: EventVisibility,
    role: ContentRole,
    attends: bool,
    expected: bool,
) -> None:
    master, override = await _occurrence(session, access, master_visibility, override_visibility)
    session.add(
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id=override.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=role,
            added_by_user_id=access.member_id,
        )
    )
    if attends:
        session.add(EventAttendee(event_id=override.id, user_id=access.peer_id))
    await session.commit()
    adapter = EventRealtimeAdapter(recording_indexer())

    granted = await adapter.authorize(session, access.peer_id, access.org_id, override.id)

    assert granted == (role if expected else None)
    assert await adapter.policy_key(session, override.id, access.org_id) == (
        ContentType.CALENDAR_EVENT,
        master.id,
    )
    # The series itself never attaches, even for its organizer; edits pick a scope first.
    assert await adapter.authorize(session, access.member_id, access.org_id, master.id) is None


async def _seeded(session: AsyncSession, key, organization_id) -> SimpleNamespace:
    """Seed the shared document; return scalars, since the row object itself is what mutates."""
    await lock_document(session, key)
    await stage_seed(session, key, organization_id)
    seed = await load_snapshot(session, key)
    assert seed is not None
    await session.commit()
    return SimpleNamespace(generation=seed.generation, revision=seed.revision)


@pytest.mark.parametrize("description", [None, "RPC replacement"])
async def test_event_update_merges_only_description_into_snapshot(
    session: AsyncSession,
    access: SimpleNamespace,
    valkey_namespace: str,
    description: str | None,
) -> None:
    event, _ = await _private_event(session, access)
    key = ContentType.CALENDAR_EVENT, event.id
    seed = await _seeded(session, key, access.org_id)
    operations = CalendarEventOperations(
        session, recording_indexer(), UpdateBuffer(namespace=valkey_namespace)
    )
    async with doc_subscription(key) as subscription:
        await operations.update(
            access.member_id,
            access.org_id,
            event.id,
            description=description,
            base_description=event.description,
            call_lifecycle=MagicMock(),
        )
        replaced = await replacements(subscription)
    snapshot = await load_snapshot(session, key)
    assert snapshot is not None
    assert snapshot.generation == seed.generation
    if description is None:
        assert snapshot.revision == seed.revision
        assert replaced == 0
        await session.delete(snapshot)
        await session.commit()
    else:
        assert str(markdown_text(decode_snapshot(snapshot))) == description
        assert snapshot.revision == snapshot.rendered_revision == seed.revision + 1
        assert replaced == 1


@pytest.mark.parametrize("description", [None, "RPC replacement"])
async def test_task_update_merges_only_description_into_snapshot(
    session: AsyncSession,
    access: SimpleNamespace,
    valkey_namespace: str,
    description: str | None,
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
    content = TaskContentOperations(session, search_indexer=recording_indexer())
    fields = (
        {}
        if description is None
        else {"description": description, "base_description": task.description}
    )
    async with doc_subscription(key) as subscription:
        await TaskMutationOperations(
            session, content, UpdateBuffer(namespace=valkey_namespace)
        ).update(
            access.member_id,
            access.org_id,
            task.id,
            **fields,
        )
        replaced = await replacements(subscription)
    snapshot = await load_snapshot(session, key)
    assert snapshot is not None
    assert snapshot.generation == seed.generation
    if description is None:
        assert snapshot.revision == seed.revision
        assert replaced == 0
        await session.delete(snapshot)
        await session.commit()
    else:
        assert str(markdown_text(decode_snapshot(snapshot))) == description
        assert snapshot.revision == snapshot.rendered_revision == seed.revision + 1
        assert replaced == 1


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
    adapter = EventRealtimeAdapter(recording_indexer())
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
    engine = RecordingSearchEngine()
    if content_type == ContentType.CALENDAR_EVENT:
        row, _grant = await _private_event(session, access)
        persistence = EventRealtimePersistence(session, recording_indexer(engine))
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
        persistence = TaskRealtimePersistence(session, recording_indexer(engine))
    urn = build_content_urn(content_type, row.id)

    async with listening(f"content:{access.org_id}") as subscription:
        staged = await persistence.stage_save(access.org_id, row.id, "Committed preview")
        assert staged is not None
        assert await changed(subscription) == []
        assert not indexed(engine, urn)
        await session.commit()
        await staged[1]()
        assert await changed(subscription) == [str(row.id)]
    assert indexed(engine, urn)
    async with open_session() as reader:
        stored = await reader.get(type(row), row.id)
    assert stored is not None
    assert stored.description == "Committed preview"
