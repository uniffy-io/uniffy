"""Task mutation operations."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.projects.tasks.creation import TaskCreateOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations
from uniffy.domains.projects.tasks.reader import TaskReader


class TaskOperations(TaskReader):
    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
    ) -> None:
        super().__init__(session, storage, search_indexer)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        title: str,
        task_type: str = "task",
        tag_ids: list[UUID] | None = None,
        **kwargs,
    ) -> Task:
        return await TaskCreateOperations(self.session, self).create(
            user_id,
            organization_id,
            project_id,
            title,
            task_type,
            tag_ids,
            **kwargs,
        )

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        **kwargs,
    ) -> tuple[Task, Task | None]:
        return await TaskMutationOperations(self.session, self).update(
            user_id,
            organization_id,
            task_id,
            **kwargs,
        )

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        status: str,
        sort_order: int,
    ) -> tuple[Task, Task | None]:
        return await self.update(
            user_id,
            organization_id,
            task_id,
            status=status,
            sort_order=sort_order,
        )

    async def bulk_update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_ids: list[str],
        **changes,
    ) -> list[Task]:
        updated: list[Task] = []
        for task_id in task_ids:
            task, _ = await self.update(user_id, organization_id, UUID(task_id), **changes)
            updated.append(task)
        return updated

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        permanent: bool = False,
    ) -> bool:
        return await TaskMutationOperations(self.session, self).delete(
            user_id,
            organization_id,
            task_id,
            permanent,
        )
