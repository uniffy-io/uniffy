"""
Projects query helpers.

Helper functions for complex queries and data extraction.
"""

import re
from collections import defaultdict
from uuid import UUID

from sqlalchemy import and_, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig


async def get_fields_for_project(
    session: AsyncSession,
    project_id: UUID,
) -> list[FieldDefinition]:
    """
    Get all field definitions for a project.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_id : UUID
        Project ID.

    Returns
    -------
    list[FieldDefinition]
        List of field definitions ordered by sort_order.

    """
    result = await session.execute(
        select(FieldDefinition)
        .where(FieldDefinition.project_id == project_id)
        .order_by(FieldDefinition.sort_order.asc())
    )
    return list(result.scalars().all())


async def get_views_for_project(
    session: AsyncSession,
    project_id: UUID,
) -> list[ViewConfig]:
    """
    Get all view configurations for a project.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_id : UUID
        Project ID.

    Returns
    -------
    list[ViewConfig]
        List of view configurations.

    """
    result = await session.execute(select(ViewConfig).where(ViewConfig.project_id == project_id))
    return list(result.scalars().all())


async def get_fields_for_projects(
    session: AsyncSession,
    project_ids: list[UUID],
) -> dict[str, list[FieldDefinition]]:
    """
    Get field definitions for multiple projects in a single query.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_ids : list[UUID]
        Project IDs.

    Returns
    -------
    dict[str, list[FieldDefinition]]
        Mapping of project_id (as string) to its field definitions.

    """
    if not project_ids:
        return {}

    result = await session.execute(
        select(FieldDefinition)
        .where(FieldDefinition.project_id.in_(project_ids))
        .order_by(FieldDefinition.sort_order.asc())
    )
    fields = result.scalars().all()

    grouped: dict[str, list[FieldDefinition]] = defaultdict(list)
    for field in fields:
        grouped[str(field.project_id)].append(field)

    return grouped


async def get_views_for_projects(
    session: AsyncSession,
    project_ids: list[UUID],
) -> dict[str, list[ViewConfig]]:
    """
    Get view configurations for multiple projects in a single query.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_ids : list[UUID]
        Project IDs.

    Returns
    -------
    dict[str, list[ViewConfig]]
        Mapping of project_id (as string) to its view configurations.

    """
    if not project_ids:
        return {}

    result = await session.execute(select(ViewConfig).where(ViewConfig.project_id.in_(project_ids)))
    views = result.scalars().all()

    grouped: dict[str, list[ViewConfig]] = defaultdict(list)
    for view in views:
        grouped[str(view.project_id)].append(view)

    return grouped


async def get_subtask_counts(
    session: AsyncSession,
    parent_ids: list[UUID],
) -> dict[UUID, tuple[int, int]]:
    """
    Batch-load subtask counts for parent tasks.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    parent_ids : list[UUID]
        Parent task IDs to load counts for.

    Returns
    -------
    dict[UUID, tuple[int, int]]
        Mapping of parent_id to (total_count, completed_count).

    """
    if not parent_ids:
        return {}

    result = await session.execute(
        select(
            Task.parent_id,
            func.count().label("total"),
            func.count(case((Task.status == "status_done", 1))).label("completed"),
        )
        .where(
            and_(
                Task.parent_id.in_(parent_ids),
                Task.is_deleted == False,  # noqa: E712
            )
        )
        .group_by(Task.parent_id)
    )
    rows = result.all()

    return {row.parent_id: (row.total, row.completed) for row in rows}


async def get_activities_for_task(
    session: AsyncSession,
    task_id: UUID,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[TaskActivity], int]:
    """
    Get paginated activity log for a task.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    task_id : UUID
        Task ID.
    page : int
        Page number (1-indexed).
    page_size : int
        Items per page.

    Returns
    -------
    tuple[list[TaskActivity], int]
        List of activities and total count.

    """
    # Count total
    count_result = await session.execute(
        select(func.count()).select_from(
            select(TaskActivity).where(TaskActivity.task_id == task_id).subquery()
        )
    )
    total = count_result.scalar_one()

    # Fetch paginated, ordered by timestamp descending (newest first)
    result = await session.execute(
        select(TaskActivity)
        .where(TaskActivity.task_id == task_id)
        .order_by(TaskActivity.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    activities = list(result.scalars().all())

    return activities, total


async def delete_project_cascade(
    session: AsyncSession,
    project_id: UUID,
) -> None:
    """
    Delete all data associated with a project.

    This includes:
    - All tasks (which cascades to activities via FK)
    - All field definitions
    - All view configurations

    Parameters
    ----------
    session : AsyncSession
        Database session.
    project_id : UUID
        Project ID to delete data for.

    """
    # Delete activities for all tasks in the project
    await session.execute(
        delete(TaskActivity).where(
            TaskActivity.task_id.in_(select(Task.id).where(Task.project_id == project_id))
        )
    )

    # Delete tasks
    await session.execute(delete(Task).where(Task.project_id == project_id))

    # Delete field definitions
    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))

    # Delete views
    await session.execute(delete(ViewConfig).where(ViewConfig.project_id == project_id))


def extract_urns_from_content(content: str) -> list[str]:
    """
    Extract URN references from markdown content.

    Matches the pattern: [[[label|urn:uniffy:content:TYPE:uuid]]]

    Parameters
    ----------
    content : str
        Markdown content with potential URN mentions.

    Returns
    -------
    list[str]
        List of unique URN strings found in the content.

    """
    if not content:
        return []

    # Pattern matches: [[[anything|urn:uniffy:content:TYPE:uuid]]]
    pattern = r"\[\[\[.*?\|(urn:uniffy:content:\w+:[a-f0-9-]+)\]\]\]"
    matches = re.findall(pattern, content, re.IGNORECASE)

    # Return unique URNs preserving order
    seen = set()
    urns = []
    for urn in matches:
        if urn not in seen:
            seen.add(urn)
            urns.append(urn)

    return urns
