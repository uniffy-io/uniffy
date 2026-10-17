"""Organization default changes reach the search policy of inheriting notes, tasks and events."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import QueueName
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.search_acl_refresh import ProjectSearchAclRefresh
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer, build_content_urn
from uniffy.core.search.workspace import WORKSPACE_SEARCH_CTX_KEY, WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.jobs.contracts import REINDEX_ORG_CONTENT_FOR_DEFAULTS
from uniffy.domains.permissions.jobs.jobs import (
    REINDEX_BATCH_SIZE,
    reindex_org_content_for_defaults,
)
from uniffy.domains.projects.jobs.jobs import refresh_project_search_acl
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.queue import get_queue
from uniffy.tests.integration.access.recording_search import RecordingSearchEngine
from uniffy.vendor.arq import Retry
from uniffy.vendor.arq.jobs import Job

pytestmark = pytest.mark.asyncio(loop_scope="session")

ENTITY_TYPES = {
    ContentType.NOTE: "note",
    ContentType.TASK: "task",
    ContentType.CALENDAR_EVENT: "calendar_event",
}


@pytest_asyncio.fixture(loop_scope="session")
async def inheriting(session: AsyncSession, access: SimpleNamespace) -> SimpleNamespace:
    """A note, a task and an event that store no policy of their own; teardown is the org's."""
    suffix = generate_id().hex[-12:]
    note = Note(
        organization_id=access.org_id,
        owner_id=access.member_id,
        title="Inherits",
        slug=f"inherits-{suffix}",
    )
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Inherits",
        slug=f"inh-{suffix}",
        task_counter=1,
    )
    calendar = Calendar(organization_id=access.org_id, owner_id=access.member_id, name="Inherits")
    session.add_all([note, project, calendar])
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Inherits",
        number=1,
    )
    start = datetime.now(UTC)
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Inherits",
        start_time=start,
        end_time=start + timedelta(hours=1),
    )
    session.add_all([task, event])
    await session.commit()
    return SimpleNamespace(
        org=access.org_id,
        admin=access.owner_id,
        owner=access.member_id,
        project=project.id,
        items={
            ContentType.NOTE: note.id,
            ContentType.TASK: task.id,
            ContentType.CALENDAR_EVENT: event.id,
        },
    )


@pytest_asyncio.fixture(loop_scope="session")
async def engine() -> RecordingSearchEngine:
    return RecordingSearchEngine()


async def index_private(
    engine: RecordingSearchEngine,
    organization_id: UUID,
    owner_id: UUID,
    items: list[tuple[ContentType, UUID]],
    project_id: UUID | None = None,
) -> None:
    """Index the items with the private policy they held before the defaults change."""
    indexer = SearchIndexer(WorkspaceSearch(engine))
    for content_type, content_id in items:
        await indexer.index(
            urn=build_content_urn(content_type, content_id),
            organization_id=organization_id,
            title="Inherits",
            entity_type=ENTITY_TYPES[content_type],
            url_path="/",
            owner_id=owner_id,
            access_mode=AccessMode.OWNER_ONLY,
            baseline_role=None,
            metadata={"project_id": str(project_id)} if content_type is ContentType.TASK else None,
        )


def policy(engine: RecordingSearchEngine, content_type: ContentType, content_id: UUID) -> tuple:
    document = engine.indexed(content_type, content_id)
    assert document is not None
    return document["access_mode"], document["baseline_role"]


async def open_to_org(organization_id: UUID, admin: UUID, content_type: ContentType) -> str:
    """Change one content type's default; returns the queued reindex job id."""
    async with open_session() as db:
        defaults = await OrganizationOperations(db).update_permission_defaults(
            admin, organization_id, content_type, AccessMode.OPEN_TO_ORG, ContentRole.COMMENTER
        )
        run_id = str(int(defaults.updated_at.timestamp() * 1_000_000))
    return f"reindex_defaults:{organization_id}:{content_type.value}:{run_id}"


async def queued_args(job_id: str) -> tuple[Any, ...]:
    pool = get_queue(QueueName.CORE)
    info = await Job(job_id, pool, _queue_name=pool.default_queue_name).info()
    assert info is not None
    assert info.function == REINDEX_ORG_CONTENT_FOR_DEFAULTS.name
    return info.args


async def test_org_default_change_reindexes_inheriting_notes_tasks_and_events(
    inheriting: SimpleNamespace, engine: RecordingSearchEngine
) -> None:
    await index_private(
        engine, inheriting.org, inheriting.owner, list(inheriting.items.items()), inheriting.project
    )
    search = WorkspaceSearch(engine)
    ctx = {SEARCH_INDEXER_CTX_KEY: SearchIndexer(search), "job_try": 1}

    for content_type in (ContentType.NOTE, ContentType.PROJECT, ContentType.CALENDAR_EVENT):
        job_id = await open_to_org(inheriting.org, inheriting.admin, content_type)
        result = await reindex_org_content_for_defaults(ctx, *await queued_args(job_id))
        assert result["status"] == "complete"
    # A project page leaves its tasks to the project's own refresh.
    assert policy(engine, ContentType.TASK, inheriting.items[ContentType.TASK]) == (
        AccessMode.OWNER_ONLY.value,
        None,
    )
    refreshed = await refresh_project_search_acl(
        {WORKSPACE_SEARCH_CTX_KEY: search}, str(inheriting.project)
    )

    assert refreshed == {"status": "complete", "updated": 1}
    for content_type, content_id in inheriting.items.items():
        assert policy(engine, content_type, content_id) == (
            AccessMode.OPEN_TO_ORG.value,
            ContentRole.COMMENTER.value,
        )


async def test_search_outage_retries_the_page_and_records_no_project_refresh(
    inheriting: SimpleNamespace, engine: RecordingSearchEngine
) -> None:
    await index_private(
        engine, inheriting.org, inheriting.owner, list(inheriting.items.items()), inheriting.project
    )
    ctx = {SEARCH_INDEXER_CTX_KEY: SearchIndexer(WorkspaceSearch(engine)), "job_try": 2}
    args = await queued_args(
        await open_to_org(inheriting.org, inheriting.admin, ContentType.PROJECT)
    )

    engine.available = False
    with pytest.raises(Retry):
        await reindex_org_content_for_defaults(ctx, *args)
    async with open_session() as db:
        pending = await db.scalar(
            select(ProjectSearchAclRefresh).where(
                ProjectSearchAclRefresh.project_id == inheriting.project
            )
        )
    engine.available = True
    retried = await reindex_org_content_for_defaults(ctx, *args)

    assert pending is None
    assert retried["status"] == "complete"
    async with open_session() as db:
        recorded = await db.scalar(
            select(ProjectSearchAclRefresh).where(
                ProjectSearchAclRefresh.project_id == inheriting.project
            )
        )
    assert recorded is not None


@pytest_asyncio.fixture(loop_scope="session")
async def many_notes(session: AsyncSession, access: SimpleNamespace) -> AsyncIterator[list[UUID]]:
    """One more inheriting note than a reindex page holds; teardown is the org's."""
    notes = [
        Note(
            organization_id=access.org_id,
            owner_id=access.member_id,
            title="Page",
            slug=f"page-{generate_id().hex}",
        )
        for _ in range(REINDEX_BATCH_SIZE + 1)
    ]
    session.add_all(notes)
    await session.commit()
    yield sorted(note.id for note in notes)


async def test_a_full_page_queues_its_continuation_after_the_last_row(
    access: SimpleNamespace, many_notes: list[UUID], engine: RecordingSearchEngine
) -> None:
    await index_private(
        engine, access.org_id, access.member_id, [(ContentType.NOTE, note) for note in many_notes]
    )
    ctx = {SEARCH_INDEXER_CTX_KEY: SearchIndexer(WorkspaceSearch(engine)), "job_try": 1}
    args = await queued_args(await open_to_org(access.org_id, access.owner_id, ContentType.NOTE))

    first = await reindex_org_content_for_defaults(ctx, *args)
    cursor, run_id = many_notes[REINDEX_BATCH_SIZE - 1], args[3]
    continuation = await queued_args(
        f"reindex_defaults_page:{access.org_id}:{ContentType.NOTE.value}:{run_id}:{cursor}"
    )
    second = await reindex_org_content_for_defaults(ctx, *continuation)

    assert (first["status"], first["processed"]) == ("queued", REINDEX_BATCH_SIZE)
    assert continuation == (str(access.org_id), ContentType.NOTE.value, str(cursor), run_id)
    assert (second["status"], second["processed"]) == ("complete", 1)
    assert {policy(engine, ContentType.NOTE, note_id) for note_id in many_notes} == {
        (AccessMode.OPEN_TO_ORG.value, ContentRole.COMMENTER.value)
    }
