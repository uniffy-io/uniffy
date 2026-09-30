from uuid import UUID

import pycrdt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import replace_external_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.realtime import TaskRealtimePersistence


class TaskRealtimeAdapter:
    content_type = ContentType.TASK

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def _load(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> Task | None:
        return (
            await session.execute(
                select(Task)
                .join(Project, Project.id == Task.project_id)
                .where(
                    Task.id == content_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted.is_(False),
                    Project.organization_id == organization_id,
                    Project.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()

    async def authorize(
        self, session: AsyncSession, user_id: UUID, organization_id: UUID, content_id: UUID
    ) -> ContentRole | None:
        task = await self._load(session, content_id, organization_id)
        if task is None:
            return None
        return await TaskContentOperations(session)._resolve_role(user_id, organization_id, task)

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        task = await self._load(session, content_id, organization_id)
        return (ContentType.PROJECT, task.project_id) if task is not None else None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        task = await self._load(session, content_id, organization_id)
        if task is not None:
            ydoc["markdown"] = pycrdt.Text(task.description or "")

    async def render_and_persist(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> bool:
        content = str(ydoc.get("markdown", type=pycrdt.Text))
        saved = await TaskRealtimePersistence(session, self.search_indexer).save(
            organization_id, content_id, content
        )
        return saved is not None

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        return replace_external_markdown(ydoc, content)


def register_task_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(TaskRealtimeAdapter(search_indexer))
