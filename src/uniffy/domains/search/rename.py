"""Propagate current labels to stored URN mentions across content domains."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label, replace_mention_label_in_canvas
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.models.shared import NodeType
from uniffy.domains.search.jobs.contracts import REINDEX_RENAMED_CONTENT

logger = logger.bind(component="search.rename")


async def propagate_rename(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> int:
    updated_notes = await _propagate_to_notes(
        session,
        organization_id,
        target_urn,
        new_label,
    )
    updated_events = await _propagate_to_calendar_events(
        session,
        organization_id,
        target_urn,
        new_label,
    )
    updated_tasks = await _propagate_to_tasks(
        session,
        organization_id,
        target_urn,
        new_label,
    )
    await session.commit()

    updated_count = len(updated_notes) + len(updated_events) + len(updated_tasks)
    if not updated_count:
        return 0

    logger.info(
        "Propagated rename to mentioning content",
        target_urn=target_urn,
        new_label=new_label,
        updated_count=updated_count,
    )
    payload = dumps_str({
        "organization_id": str(organization_id),
        "note_ids": [str(note.id) for note in updated_notes],
        "event_ids": [str(event.id) for event in updated_events],
        "task_ids": [str(task.id) for task in updated_tasks],
    })
    await enqueue_job(REINDEX_RENAMED_CONTENT, payload)
    return updated_count


async def _propagate_to_notes(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> list[Note]:
    result = await session.execute(
        select(Note).where(
            Note.organization_id == organization_id,
            Note.is_deleted == False,  # noqa: E712
            Note.outgoing_references.contains([target_urn]),
        )
    )
    notes = list(result.scalars().all())
    updated: list[Note] = []

    for note in notes:
        changed = False
        if note.node_type == NodeType.CANVAS and note.canvas_content:
            canvas, changed = replace_mention_label_in_canvas(
                note.canvas_content,
                target_urn,
                new_label,
            )
            if changed:
                note.canvas_content = canvas
        elif note.content:
            content = replace_mention_label(note.content, target_urn, new_label)
            if content != note.content:
                note.content = content
                changed = True

        if changed:
            note.updated_at = datetime.now(UTC)
            updated.append(note)

    return updated


async def _propagate_to_calendar_events(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> list[CalendarEvent]:
    result = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.outgoing_references.contains([target_urn]),
        )
    )
    events = list(result.scalars().all())
    updated: list[CalendarEvent] = []

    for event in events:
        if not event.description:
            continue
        description = replace_mention_label(event.description, target_urn, new_label)
        if description != event.description:
            event.description = description
            event.updated_at = datetime.now(UTC)
            updated.append(event)

    return updated


async def _propagate_to_tasks(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> list[Task]:
    result = await session.execute(
        select(Task).where(
            Task.organization_id == organization_id,
            Task.outgoing_references.contains([target_urn]),
        )
    )
    tasks = list(result.scalars().all())
    updated: list[Task] = []

    for task in tasks:
        if not task.description:
            continue
        description = replace_mention_label(task.description, target_urn, new_label)
        if description != task.description:
            task.description = description
            task.updated_at = datetime.now(UTC)
            updated.append(task)

    return updated
