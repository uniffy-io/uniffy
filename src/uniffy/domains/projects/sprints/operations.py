"""Project sprint operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task
from uniffy.domains.projects.projects import ProjectOperations

logger = logger.bind(component="projects.sprints")


class SprintOperations:
    """Project-scoped iteration containers; access delegates to the parent project."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _verify_project_manage(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> None:
        await ProjectOperations(self.session).get_for_manage(user_id, organization_id, project_id)

    async def _get_sprint(self, sprint_id: UUID, organization_id: UUID) -> Sprint:
        result = await self.session.execute(
            select(Sprint).where(
                Sprint.id == sprint_id,
                Sprint.organization_id == organization_id,
            )
        )
        sprint = result.scalar_one_or_none()
        if not sprint:
            raise NotFoundError("Sprint", str(sprint_id))
        return sprint

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        name: str,
        goal: str = "",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        await self._verify_project_manage(user_id, organization_id, project_id)

        max_result = await self.session.execute(
            select(func.max(Sprint.sort_order)).where(
                Sprint.project_id == project_id,
                Sprint.organization_id == organization_id,
            )
        )
        current_max = max_result.scalar() or 0
        new_sort_order = current_max + 1

        sprint = Sprint(
            project_id=project_id,
            organization_id=organization_id,
            name=name,
            goal=goal,
            status="planned",
            start_date=start_date,
            end_date=end_date,
            sort_order=new_sort_order,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        self.session.add(sprint)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
        name: str | None = None,
        goal: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        """Requires manage on the parent project."""
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        if name is not None:
            sprint.name = name
        if goal is not None:
            sprint.goal = goal
        if start_date is not None:
            sprint.start_date = start_date
        if end_date is not None:
            sprint.end_date = end_date

        sprint.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def start(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        """Only one active sprint per project is allowed."""
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        if sprint.status == SprintStatus.ACTIVE:
            return sprint

        sprint.status = SprintStatus.ACTIVE
        if start_date is not None:
            sprint.start_date = start_date
        if end_date is not None:
            sprint.end_date = end_date
        sprint.updated_at = datetime.now(UTC)

        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise ValidationError("sprint", "A sprint is already active in this project")

        await self.session.refresh(sprint)
        return sprint

    async def complete(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
    ) -> Sprint:
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        sprint.status = SprintStatus.CLOSED
        sprint.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
    ) -> bool:
        """Moves tasks back to the backlog."""
        from sqlalchemy import update as sa_update

        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        await self.session.execute(
            sa_update(Task)
            .where(Task.sprint_id == sprint_id)
            .values(sprint_id=None, updated_at=datetime.now(UTC))
        )

        await self.session.delete(sprint)
        await self.session.commit()
        return True

    async def list_sprints(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_closed: bool = False,
    ) -> list[Sprint]:
        project_ops = ProjectOperations(self.session)
        await project_ops.get_by_id(user_id, organization_id, project_id)

        query = select(Sprint).where(
            Sprint.project_id == project_id,
            Sprint.organization_id == organization_id,
        )

        if not include_closed:
            query = query.where(Sprint.status != SprintStatus.CLOSED)

        query = query.order_by(Sprint.sort_order.asc(), Sprint.created_at.asc())

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_task_counts(self, sprint_ids: list[UUID]) -> dict[str, tuple[int, int]]:
        if not sprint_ids:
            return {}

        result = await self.session.execute(
            select(
                Task.sprint_id,
                func.count(Task.id).label("total"),
                func.count(Task.completed_at).label("completed"),
            )
            .where(
                Task.sprint_id.in_(sprint_ids),
                Task.is_deleted == False,  # noqa: E712
            )
            .group_by(Task.sprint_id)
        )

        counts: dict[str, tuple[int, int]] = {}
        for row in result:
            counts[str(row.sprint_id)] = (row.total, row.completed)
        return counts
