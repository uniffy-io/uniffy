"""Shared notes, tasks and events bound to a buffer epoch, and the member changes governing them."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import lock_document, stage_seed
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import BufferedDocument, establish
from uniffy.tests.integration.access.recording_search import recording_indexer

LIVE_TYPES = (ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT)
_ADAPTERS = {
    ContentType.NOTE: NoteRealtimeAdapter,
    ContentType.TASK: TaskRealtimeAdapter,
    ContentType.CALENDAR_EVENT: EventRealtimeAdapter,
}


@dataclass
class SharedDocument:
    """A live document and the row whose members govern it: the project for a task."""

    doc: BufferedDocument
    policy: DocKey


async def create_document(
    access: Any, buffer: UpdateBuffer, content_type: ContentType, access_mode: AccessMode | None
) -> SharedDocument:
    """The member's note, task or event, seeded with ``base`` and bound to a fresh buffer epoch."""
    register_realtime_adapter(_ADAPTERS[content_type](recording_indexer()))
    register_calendar_content()
    org, owner = access.org_id, access.member_id
    slug = f"parity-{generate_id().hex[-12:]}"
    policy: DocKey | None = None
    async with open_session() as db:
        row: Note | Task | CalendarEvent
        if content_type is ContentType.TASK:
            project = Project(
                organization_id=org,
                owner_id=owner,
                name="Parity",
                slug=slug,
                access_mode=access_mode,
                task_counter=1,
            )
            db.add(project)
            await db.flush()
            row = Task(
                organization_id=org,
                project_id=project.id,
                owner_id=owner,
                title="Parity",
                number=1,
                description="base",
            )
            policy = (ContentType.PROJECT, project.id)
        elif content_type is ContentType.CALENDAR_EVENT:
            calendar = Calendar(organization_id=org, owner_id=owner, name="Parity")
            db.add(calendar)
            await db.flush()
            start = datetime.now(UTC)
            row = CalendarEvent(
                organization_id=org,
                organizer_id=owner,
                calendar_id=calendar.id,
                title="Parity",
                description="base",
                start_time=start,
                end_time=start + timedelta(hours=1),
                access_mode=access_mode,
            )
        else:
            row = Note(
                organization_id=org,
                owner_id=owner,
                title="Parity",
                slug=slug,
                content="base",
                access_mode=access_mode,
            )
        db.add(row)
        await db.commit()
        key = (content_type, row.id)
        await lock_document(db, key, org)
        seeded = await stage_seed(db, key, org)
        await db.commit()
        base, generation = seeded.updates, seeded.generation
    assert generation is not None
    document = BufferedDocument(
        key=key,
        org=org,
        owner=owner,
        peer=access.peer_id,
        namespace=buffer.namespace,
        buffer=buffer,
        base=base,
        generation=generation,
        head=await establish(buffer, key, org),
    )
    return SharedDocument(document, policy or key)


async def discard(key: DocKey) -> None:
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
        )
        await db.commit()


def _members(db: AsyncSession) -> ContentMembersOperations:
    return ContentMembersOperations(db, recording_indexer())


async def share(document: SharedDocument, role: ContentRole) -> None:
    async with open_session() as db:
        await _members(db).add_member(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
            role,
        )


async def change_role(document: SharedDocument, role: ContentRole) -> None:
    async with open_session() as db:
        await _members(db).update_member_role(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
            role,
        )


async def unshare(document: SharedDocument) -> None:
    async with open_session() as db:
        await _members(db).remove_member(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            SubjectType.USER,
            document.doc.peer,
        )


async def make_private(document: SharedDocument) -> None:
    async with open_session() as db:
        await _members(db).set_access_mode(
            document.doc.owner,
            document.doc.org,
            *document.policy,
            AccessMode.OWNER_ONLY,
            remove_members_on_narrow=True,
        )


async def leave_organization(access: Any, user: UUID) -> None:
    async with open_session() as db:
        assert await OrganizationOperations(db).remove_member(
            access.owner_id,
            access.org_id,
            user,
            search_indexer=recording_indexer(),
            call_lifecycle=CallsLifecycle(open_session),
        )
