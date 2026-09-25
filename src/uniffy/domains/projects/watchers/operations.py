"""Task watcher operations."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.user import User
from uniffy.core.models.projects.task_watcher import TaskWatcher
from uniffy.core.types import (
    generate_id,
)


class WatcherOperations:
    """Subscribe/unsubscribe to task updates."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def toggle(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
    ) -> tuple[bool, TaskWatcher | None]:
        existing = await self._get_watcher(user_id, task_id)
        if existing:
            await self.session.delete(existing)
            await self.session.commit()
            return False, None

        watcher = TaskWatcher(
            user_id=user_id,
            organization_id=organization_id,
            task_id=task_id,
        )
        self.session.add(watcher)
        await self.session.commit()
        await self.session.refresh(watcher)
        return True, watcher

    async def ensure_watching(
        self,
        user_ids: list[UUID],
        organization_id: UUID,
        task_id: UUID,
    ) -> None:
        """Idempotently subscribe users to a task without committing.

        Used to auto-watch the creator and assignees so they receive
        task-change notifications without having to opt in manually.
        """
        wanted = {uid for uid in user_ids}
        if not wanted:
            return
        # Assignees may include group ids; only real users can watch (FK to login_users).
        valid_rows = await self.session.execute(select(User.id).where(User.id.in_(wanted)))
        valid_ids = {row[0] for row in valid_rows.all()}
        if not valid_ids:
            return
        now = datetime.now(UTC)
        await self.session.execute(
            pg_insert(TaskWatcher)
            .values([
                {
                    "id": generate_id(),
                    "user_id": uid,
                    "organization_id": organization_id,
                    "task_id": task_id,
                    "created_at": now,
                }
                for uid in valid_ids
            ])
            .on_conflict_do_nothing(constraint="uq_task_watchers_user_task")
        )

    async def is_watching(self, user_id: UUID, task_id: UUID) -> bool:
        watcher = await self._get_watcher(user_id, task_id)
        return watcher is not None

    async def get_watcher_user_ids(self, task_id: UUID) -> list[UUID]:
        result = await self.session.execute(
            select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)
        )
        return [row[0] for row in result.all()]

    async def get_watcher_count(self, task_id: UUID) -> int:
        result = await self.session.execute(
            select(func.count()).where(TaskWatcher.task_id == task_id)
        )
        return result.scalar_one()

    async def bulk_check(self, user_id: UUID, task_ids: list[str]) -> dict[str, bool]:
        if not task_ids:
            return {}

        uuids = [UUID(tid) for tid in task_ids]
        result = await self.session.execute(
            select(TaskWatcher.task_id).where(
                and_(
                    TaskWatcher.user_id == user_id,
                    TaskWatcher.task_id.in_(uuids),
                )
            )
        )
        watched = {str(row[0]) for row in result.all()}
        return {tid: tid in watched for tid in task_ids}

    async def _get_watcher(self, user_id: UUID, task_id: UUID) -> TaskWatcher | None:
        result = await self.session.execute(
            select(TaskWatcher).where(
                and_(
                    TaskWatcher.user_id == user_id,
                    TaskWatcher.task_id == task_id,
                )
            )
        )
        return result.scalar_one_or_none()
