from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import RealtimeRenderConflict, check_not_superseded
from uniffy.core.realtime.metrics import REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.projects.queries import extract_urns_from_content
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.notifications import TaskNotifications

logger = logger.bind(component="projects.tasks.realtime")


async def load_live_task(
    session: AsyncSession,
    task_id: UUID,
    organization_id: UUID,
    *,
    populate_existing: bool = False,
) -> Task | None:
    """Task under a live project in the same org; the project carries the access policy."""
    query = (
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .where(
            Task.id == task_id,
            Task.organization_id == organization_id,
            Task.is_deleted.is_(False),
            Project.organization_id == organization_id,
            Project.is_deleted.is_(False),
        )
    )
    if populate_existing:
        query = query.execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


class TaskRealtimePersistence:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def stage_save(
        self,
        organization_id: UUID,
        task_id: UUID,
        content: str,
        *,
        actor_id: UUID | None = None,
        supersede_after: datetime | None = None,
    ) -> tuple[Task, Callable[[], Awaitable[None]]] | None:
        references = extract_urns_from_content(content) or None
        for attempt in range(3):
            task = await load_live_task(
                self.session, task_id, organization_id, populate_existing=True
            )
            if task is None:
                return None
            if not attempt:
                check_not_superseded(
                    task.updated_at,
                    supersede_after,
                    stored=task.description,
                    rendered=content,
                    label=f"Task {task_id}",
                )
            old_refs = task.outgoing_references
            if not attempt and task.description and not content:
                REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL.labels(
                    content_type=ContentType.TASK.value
                ).inc()
                logger.warning("Realtime render emptied task description", task_id=str(task_id))
            result = await self.session.execute(
                update(Task)
                .where(
                    Task.id == task_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted.is_(False),
                    Task.version == task.version,
                )
                .values(
                    description=content,
                    outgoing_references=references,
                    version=task.version + 1,
                    updated_at=datetime.now(UTC),
                )
                .execution_options(synchronize_session=False)
            )
            if result.rowcount:
                break
        else:
            raise RealtimeRenderConflict(f"Task {task_id} remained contended after three attempts")

        await self.session.refresh(task)

        async def after_commit() -> None:
            await TaskContentOperations(
                self.session, search_indexer=self.search_indexer
            )._index_for_search(task)
            project = await self.session.get(Project, task.project_id)
            if project is not None:
                # Attribute mentions to the last live editor, or the project owner.
                await TaskNotifications(self.session).emit_mention_notifications(
                    task, actor_id or project.owner_id, old_refs, task.outgoing_references
                )

        return task, after_commit

    async def save(
        self,
        organization_id: UUID,
        task_id: UUID,
        content: str,
        *,
        actor_id: UUID | None = None,
        supersede_after: datetime | None = None,
    ) -> Task | None:
        staged = await self.stage_save(
            organization_id, task_id, content, actor_id=actor_id, supersede_after=supersede_after
        )
        if staged is None:
            return None
        task, after_commit = staged
        await self.session.commit()
        await after_commit()
        return task
