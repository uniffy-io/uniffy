"""Projects query helpers."""

import re
from collections import defaultdict
from datetime import UTC, datetime
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import Select, and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ProjectViewVisibility, ViewConfig
from uniffy.core.models.shared import ContentRole, ContentType


async def get_fields_for_project(
    session: AsyncSession,
    project_id: UUID,
) -> list[FieldDefinition]:
    result = await session.execute(
        select(FieldDefinition)
        .where(FieldDefinition.project_id == project_id)
        .order_by(FieldDefinition.sort_order.asc())
    )
    return list(result.scalars().all())


def _visible_views(viewer_id: UUID) -> Select[tuple[ViewConfig]]:
    """Every shared view plus the viewer's own personal views, shared first."""
    return (
        select(ViewConfig)
        .where(
            or_(
                ViewConfig.visibility == ProjectViewVisibility.SHARED,
                ViewConfig.owner_id == viewer_id,
            )
        )
        .order_by(
            case((ViewConfig.visibility == ProjectViewVisibility.SHARED, 0), else_=1),
            ViewConfig.sort_order.asc(),
            ViewConfig.created_at.asc(),
            ViewConfig.id.asc(),
        )
    )


async def get_views_for_project(
    session: AsyncSession,
    project_id: UUID,
    viewer_id: UUID,
) -> list[ViewConfig]:
    result = await session.execute(
        _visible_views(viewer_id).where(ViewConfig.project_id == project_id)
    )
    return list(result.scalars().all())


async def get_view(
    session: AsyncSession,
    project_id: UUID,
    view_id: str,
) -> ViewConfig | None:
    result = await session.execute(
        select(ViewConfig).where(
            ViewConfig.project_id == project_id,
            ViewConfig.id == view_id,
        )
    )
    return result.scalar_one_or_none()


async def get_views_in_scope(
    session: AsyncSession,
    project_id: UUID,
    visibility: ProjectViewVisibility,
    owner_id: UUID,
    *,
    for_update: bool = False,
) -> list[ViewConfig]:
    """Shared views of the project, or ``owner_id``'s personal views in it."""
    query = select(ViewConfig).where(
        ViewConfig.project_id == project_id,
        ViewConfig.visibility == visibility,
    )
    if visibility is ProjectViewVisibility.PERSONAL:
        query = query.where(ViewConfig.owner_id == owner_id)
    query = query.order_by(ViewConfig.sort_order.asc(), ViewConfig.created_at.asc())
    if for_update:
        query = query.with_for_update()
    result = await session.execute(query)
    return list(result.scalars().all())


async def get_fields_for_projects(
    session: AsyncSession,
    project_ids: list[UUID],
) -> dict[str, list[FieldDefinition]]:
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
    viewer_id: UUID,
) -> dict[str, list[ViewConfig]]:
    if not project_ids:
        return {}

    result = await session.execute(
        _visible_views(viewer_id).where(ViewConfig.project_id.in_(project_ids))
    )
    views = result.scalars().all()

    grouped: dict[str, list[ViewConfig]] = defaultdict(list)
    for view in views:
        grouped[str(view.project_id)].append(view)

    return grouped


async def get_subtask_counts(
    session: AsyncSession,
    parent_ids: list[UUID],
) -> dict[UUID, tuple[int, int]]:
    """Returns parent_id -> (total, completed).

    Completion is read off ``completed_at`` rather than off the status id, so
    this agrees with the project rollups and with what the clients render.
    """
    if not parent_ids:
        return {}

    result = await session.execute(
        select(
            Task.parent_id,
            func.count().label("total"),
            func.count(case((Task.completed_at.is_not(None), 1))).label("completed"),
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


class ProjectTaskRollup(NamedTuple):
    """Per-project task numbers.

    ``total`` and ``completed`` count top-level tasks only, so they match the
    progress bar the clients draw - counting subtasks would let one heavily
    decomposed task outweigh the rest. The overdue count and the time sums span
    the whole tree, because an overdue subtask is overdue work either way.
    """

    total: int
    completed: int
    overdue: int
    estimated_minutes: int
    time_spent_minutes: int


async def get_task_rollups_for_projects(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> dict[UUID, ProjectTaskRollup]:
    if not project_ids:
        return {}

    # ``due_date`` is a plain YYYY-MM-DD string, so a string comparison is exact
    # without per-row date parsing.
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    top_level = Task.parent_id.is_(None)

    result = await session.execute(
        select(
            Task.project_id,
            func.count(case((top_level, 1))).label("total"),
            func.count(case((and_(top_level, Task.completed_at.is_not(None)), 1))).label(
                "completed"
            ),
            func.count(
                case((
                    and_(
                        Task.completed_at.is_(None),
                        Task.due_date.is_not(None),
                        Task.due_date < today,
                    ),
                    1,
                ))
            ).label("overdue"),
            func.coalesce(func.sum(Task.estimated_minutes), 0).label("estimated"),
            func.coalesce(func.sum(Task.time_spent_minutes), 0).label("spent"),
        )
        .where(
            and_(
                Task.organization_id == organization_id,
                Task.project_id.in_(project_ids),
                Task.is_deleted == False,  # noqa: E712
            )
        )
        .group_by(Task.project_id)
    )

    return {
        row.project_id: ProjectTaskRollup(
            row.total, row.completed, row.overdue, int(row.estimated), int(row.spent)
        )
        for row in result.all()
    }


async def get_member_counts_for_projects(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> dict[UUID, int]:
    if not project_ids:
        return {}

    now = datetime.now(UTC)
    result = await session.execute(
        select(ContentMember.content_id, func.count().label("total"))
        .where(
            and_(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == ContentType.PROJECT,
                ContentMember.content_id.in_(project_ids),
                # A BLOCKED row is an explicit deny, and an expired grant confers
                # nothing - neither is a member.
                ContentMember.role != ContentRole.BLOCKED,
                or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now),
            )
        )
        .group_by(ContentMember.content_id)
    )

    return {row.content_id: row.total for row in result.all()}


async def get_activities_for_task(
    session: AsyncSession,
    task_id: UUID,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[TaskActivity], int]:
    count_result = await session.execute(
        select(func.count()).select_from(
            select(TaskActivity).where(TaskActivity.task_id == task_id).subquery()
        )
    )
    total = count_result.scalar_one()

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
    """Drops tasks, field definitions, view configs (and activities via FK)."""
    await session.execute(
        delete(TaskActivity).where(
            TaskActivity.task_id.in_(select(Task.id).where(Task.project_id == project_id))
        )
    )

    await session.execute(delete(Task).where(Task.project_id == project_id))

    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))

    await session.execute(delete(ViewConfig).where(ViewConfig.project_id == project_id))


def extract_urns_from_content(content: str) -> list[str]:
    """Returns unique URNs from ``[[[label|urn:...]]]`` mentions, preserving order."""
    if not content:
        return []

    pattern = r"\[\[\[[^\[\]|]*?\|(urn:uniffy:content:\w+:[a-f0-9-]+)\]\]\]"
    matches = re.findall(pattern, content, re.IGNORECASE)

    seen = set()
    urns = []
    for urn in matches:
        if urn not in seen:
            seen.add(urn)
            urns.append(urn)

    return urns
