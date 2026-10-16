from collections.abc import Awaitable, Callable, Collection
from uuid import UUID

import pycrdt
from sqlalchemy import bindparam, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text, seed_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.projects.tasks.realtime import TaskRealtimePersistence, load_live_task

_POLICY_STATEMENT = (
    select(Project.id, Project.owner_id, Project.access_mode, Project.baseline_role)
    .join(Task, Task.project_id == Project.id)
    .where(
        Task.id == bindparam("content_id"),
        Task.organization_id == bindparam("organization_id"),
        Task.is_deleted.is_(False),
        Project.organization_id == bindparam("organization_id"),
        Project.is_deleted.is_(False),
    )
)


class TaskRealtimeAdapter:
    content_type = ContentType.TASK

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        *,
        checker: PermissionChecker | None = None,
    ) -> ContentRole | None:
        project = (
            await session.execute(
                _POLICY_STATEMENT,
                {"content_id": content_id, "organization_id": organization_id},
            )
        ).one_or_none()
        if project is None:
            return None
        return await (checker or PermissionChecker(session)).effective_role(
            user_id,
            organization_id,
            ContentType.PROJECT,
            project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        )

    async def authorize_many(
        self,
        session: AsyncSession,
        user_ids: Collection[UUID],
        organization_id: UUID,
        content_id: UUID,
    ) -> dict[UUID, ContentRole | None]:
        project = (
            await session.execute(
                _POLICY_STATEMENT,
                {"content_id": content_id, "organization_id": organization_id},
            )
        ).one_or_none()
        if project is None:
            return dict.fromkeys(user_ids)
        return await PermissionChecker(session).effective_roles(
            user_ids,
            organization_id,
            ContentType.PROJECT,
            project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        )

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        project = (
            await session.execute(
                _POLICY_STATEMENT,
                {"content_id": content_id, "organization_id": organization_id},
            )
        ).one_or_none()
        return (ContentType.PROJECT, project.id) if project is not None else None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        task = await load_live_task(session, content_id, organization_id)
        if task is not None:
            seed_markdown(ydoc, task.description or "")

    async def stage_render(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
        *,
        actor_id: UUID | None = None,
    ) -> Callable[[], Awaitable[None]] | None:
        staged = await TaskRealtimePersistence(session, self.search_indexer).stage_save(
            organization_id,
            content_id,
            str(markdown_text(ydoc)),
            actor_id=actor_id,
        )
        return staged[1] if staged is not None else None

    async def after_projection(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> None:
        await TaskRealtimePersistence(session, self.search_indexer).after_projection(
            organization_id, content_id
        )


def register_task_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(TaskRealtimeAdapter(search_indexer))
