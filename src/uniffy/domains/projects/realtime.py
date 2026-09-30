from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text, replace_external_markdown, seed_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.realtime import TaskRealtimePersistence, load_live_task


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
        task = await load_live_task(session, content_id, organization_id)
        if task is None:
            return None
        operations = TaskContentOperations(session, permission_checker=checker)
        return await operations._resolve_role(user_id, organization_id, task)

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        task = await load_live_task(session, content_id, organization_id)
        return (ContentType.PROJECT, task.project_id) if task is not None else None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        task = await load_live_task(session, content_id, organization_id)
        if task is not None:
            seed_markdown(ydoc, task.description or "")

    async def render_and_persist(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
        *,
        actor_id: UUID | None = None,
    ) -> bool:
        saved = await TaskRealtimePersistence(session, self.search_indexer).save(
            organization_id, content_id, str(markdown_text(ydoc)), actor_id=actor_id
        )
        return saved is not None

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        return replace_external_markdown(ydoc, content)


def register_task_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(TaskRealtimeAdapter(search_indexer))
