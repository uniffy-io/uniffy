"""Rename propagation for URN mentions embedded in user content."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label, replace_mention_label_in_canvas

logger = logger.bind(component="content.cascade")


async def propagate_rename(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
) -> int:
    """Rewrite ``[[[label|urn]]]`` mention labels across notes, events and tasks.

    System-initiated: ``updated_at`` bumps but ``version`` does NOT increment,
    to avoid conflict with concurrent user edits.
    """
    updated_notes = await _propagate_rename_notes(
        session,
        organization_id,
        target_urn,
        new_label,
        replace_mention_label,
        replace_mention_label_in_canvas,
    )
    updated_events = await _propagate_rename_calendar_events(
        session,
        organization_id,
        target_urn,
        new_label,
        replace_mention_label,
    )
    updated_tasks = await _propagate_rename_tasks(
        session,
        organization_id,
        target_urn,
        new_label,
        replace_mention_label,
    )

    updated_count = len(updated_notes) + len(updated_events) + len(updated_tasks)

    if updated_count:
        logger.info(
            "Propagated rename to mentioning content",
            target_urn=target_urn,
            new_label=new_label,
            updated_count=updated_count,
        )

    await _reindex_renamed_content(
        session,
        updated_notes,
        updated_events,
        updated_tasks,
    )

    return updated_count


async def _propagate_rename_notes(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
    replace_canvas_fn: object,
) -> list:
    from uniffy.core.models.notes.note import Note
    from uniffy.core.models.shared import NodeType

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
            new_canvas, canvas_changed = replace_canvas_fn(
                note.canvas_content,
                target_urn,
                new_label,
            )
            if canvas_changed:
                note.canvas_content = new_canvas
                changed = True
        elif note.content:
            new_content = replace_fn(note.content, target_urn, new_label)
            if new_content != note.content:
                note.content = new_content
                changed = True

        if changed:
            note.updated_at = datetime.now(UTC)
            updated.append(note)

    if updated:
        await session.flush()

    return updated


async def _propagate_rename_calendar_events(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
) -> list:
    from uniffy.core.models.calendar.event import CalendarEvent

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
        new_desc = replace_fn(event.description, target_urn, new_label)
        if new_desc != event.description:
            event.description = new_desc
            event.updated_at = datetime.now(UTC)
            updated.append(event)

    if updated:
        await session.flush()

    return updated


async def _propagate_rename_tasks(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    replace_fn: object,
) -> list:
    from uniffy.core.models.projects.task import Task

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
        new_desc = replace_fn(task.description, target_urn, new_label)
        if new_desc != task.description:
            task.description = new_desc
            task.updated_at = datetime.now(UTC)
            updated.append(task)

    if updated:
        await session.flush()

    return updated


async def _reindex_renamed_content(
    session: AsyncSession,
    notes: list,
    events: list,
    tasks: list,
) -> None:
    """Re-index updated content after rename propagation; failures are non-fatal."""
    if notes:
        try:
            from uniffy.domains.notes.operations import NoteOperations

            ops = NoteOperations(session)
            for note in notes:
                await ops._index_for_search(note)
        except Exception:
            logger.opt(exception=True).warning("Failed to re-index notes after rename propagation")

    if events:
        try:
            from uniffy.domains.calendar.operations import CalendarEventOperations

            ops = CalendarEventOperations(session)
            for event in events:
                await ops._index_for_search(event)
        except Exception:
            logger.opt(exception=True).warning(
                "Failed to re-index calendar events after rename propagation"
            )

    if tasks:
        try:
            from uniffy.domains.projects.operations import TaskOperations

            ops = TaskOperations(session)
            for task in tasks:
                await ops._index_for_search(task)
        except Exception:
            logger.opt(exception=True).warning("Failed to re-index tasks after rename propagation")
