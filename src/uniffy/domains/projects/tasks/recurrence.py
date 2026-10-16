"""Recurring task instance creation."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.field_definition import TaskStatusSemantic
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.live import LiveStateUnavailable, load_live_document
from uniffy.core.realtime.storage import lock_document
from uniffy.core.types import ContentType
from uniffy.domains.projects.recurrence import (
    compute_next_occurrence,
    parse_recurrence_config,
    serialize_recurrence_config,
)
from uniffy.domains.projects.statuses import TaskStatusSemantics
from uniffy.domains.projects.tasks.notifications import TaskNotifications

logger = logger.bind(component="projects.tasks.recurrence")


async def _live_description(
    session: AsyncSession, buffer: UpdateBuffer, task: Task, organization_id: UUID
) -> str:
    """The completed task's text including accepted edits that have not reached the column."""
    key = (ContentType.TASK, task.id)
    await lock_document(session, key, organization_id)
    try:
        live = await load_live_document(buffer, session, key)
    except LiveStateUnavailable:
        # The completion has already committed, so refusing here would end the series; the
        # completed task keeps its pending edits either way.
        logger.opt(exception=True).warning(
            "Recurring copy starts from the stored description", task_id=str(task.id)
        )
        return task.description or ""
    return live.text() if live is not None else task.description or ""


async def spawn_next_recurring_instance(
    session: AsyncSession,
    index_task: Callable[[Task], Awaitable[None]],
    completed_task: Task,
    organization_id: UUID,
    status_semantics: TaskStatusSemantics,
    *,
    buffer: UpdateBuffer,
) -> Task | None:
    config = parse_recurrence_config(completed_task.recurrence_rule)
    if not config:
        return None

    project = await session.get(Project, completed_task.project_id)
    if not project or project.is_deleted:
        return None

    today_str = datetime.now(UTC).strftime("%Y-%m-%d")
    base_date = completed_task.due_date or today_str
    next_date = compute_next_occurrence(base_date, config)
    if not next_date:
        return None

    config["occurrences_created"] = config.get("occurrences_created", 1) + 1
    next_rule = serialize_recurrence_config(config)

    description = await _live_description(session, buffer, completed_task, organization_id)
    counter_result = await session.execute(
        text(
            "UPDATE projects_projects "
            "SET task_counter = task_counter + 1 "
            "WHERE id = :project_id "
            "RETURNING task_counter"
        ),
        {"project_id": str(completed_task.project_id)},
    )
    task_number = counter_result.scalar_one()

    next_task = Task(
        project_id=completed_task.project_id,
        organization_id=completed_task.organization_id,
        owner_id=completed_task.owner_id,
        title=completed_task.title,
        description=description,
        status=status_semantics.id_for(TaskStatusSemantic.TODO),
        priority=completed_task.priority,
        assignee_ids=(list(completed_task.assignee_ids) if completed_task.assignee_ids else None),
        due_date=next_date,
        task_type=completed_task.task_type,
        recurrence_rule=next_rule,
        number=task_number,
        sort_order=completed_task.sort_order,
    )

    session.add(next_task)
    await session.flush()
    await session.refresh(next_task)

    await TaskNotifications(session).log_activity(next_task.id, completed_task.owner_id, "created")

    await session.commit()
    await session.refresh(next_task)

    await index_task(next_task)

    logger.info(
        "Spawned next recurring task instance",
        completed_task_id=str(completed_task.id),
        new_task_id=str(next_task.id),
        next_due_date=next_date,
    )

    return next_task
