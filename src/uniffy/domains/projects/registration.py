"""Projects content-registry bindings."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import (
    register_attachment_cascade_loader,
    register_child_acl_refresh_hook,
    register_content_loader,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.projects.search.access import (
    enqueue_project_search_acl_refresh,
    record_project_search_acl_refresh,
)

_registered = False


async def _load_project(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Project | None:
    result = await session.execute(
        select(Project).where(
            Project.id == content_id,
            Project.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _load_task(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Task | None:
    result = await session.execute(
        select(Task).where(
            Task.id == content_id,
            Task.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _project_attachment_cascade(
    session: AsyncSession,
    organization_id: UUID,
    project_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    rows = (
        (
            await session.execute(
                select(Task.id).where(
                    Task.project_id == project_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    return [(ContentType.TASK, task_id) for task_id in rows]


def register_project_content() -> None:
    global _registered
    if _registered:
        return
    register_content_loader(ContentType.PROJECT, _load_project)
    register_content_loader(ContentType.TASK, _load_task)
    register_attachment_cascade_loader(ContentType.PROJECT, _project_attachment_cascade)
    register_child_acl_refresh_hook(
        ContentType.PROJECT,
        record_project_search_acl_refresh,
        enqueue_project_search_acl_refresh,
    )
    _registered = True
