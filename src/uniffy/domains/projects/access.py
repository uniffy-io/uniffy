from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access.standard import (
    StandardPolicyRow,
    resolve_standard_rows,
)
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    AccessGrantKind,
    RequestTarget,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


async def resolve_tasks(
    session: AsyncSession,
    subject: AccessSubject,
    content_ids: Collection[UUID],
) -> dict[ResourceKey, ResourceAccessDecision]:
    if not content_ids:
        return {}
    rows = (
        await session.execute(
            select(
                Task.id,
                Task.is_deleted.label("task_deleted"),
                Project.id.label("project_id"),
                Project.owner_id,
                Project.access_mode,
                Project.baseline_role,
                Project.is_deleted.label("project_deleted"),
            )
            .join(Project, Project.id == Task.project_id)
            .where(
                Task.organization_id == subject.organization_id,
                Project.organization_id == subject.organization_id,
                Task.id.in_(content_ids),
            )
        )
    ).all()
    project_rows = {
        row.project_id: StandardPolicyRow(
            key=ResourceKey(ContentType.PROJECT, row.project_id),
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
            is_deleted=row.project_deleted,
        )
        for row in rows
    }
    project_decisions = await resolve_standard_rows(
        session,
        subject,
        project_rows.values(),
    )
    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for row in rows:
        key = ResourceKey(ContentType.TASK, row.id)
        parent = project_decisions[ResourceKey(ContentType.PROJECT, row.project_id)]
        row_state = (
            ResourceRowState.DELETED
            if row.task_deleted or parent.row_state == ResourceRowState.DELETED
            else ResourceRowState.LIVE
        )
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=row_state,
            can_view=row_state == ResourceRowState.LIVE and parent.can_view,
            role=parent.role if row_state == ResourceRowState.LIVE else None,
            request_target=(
                RequestTarget(ContentType.PROJECT, row.project_id, AccessGrantKind.STANDARD)
                if row_state == ResourceRowState.LIVE
                else None
            ),
            target_policy=(parent.target_policy if row_state == ResourceRowState.LIVE else None),
        )
    return decisions
