"""Task mutation validation."""

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.domains.projects import queries
from uniffy.domains.projects.validation import validate_field_values


class TaskValidator:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def blockers_resolved(
        self,
        task: Task,
        completing: bool,
    ) -> list[dict[str, str]]:
        if not completing:
            return []

        if not task.blocked_by_task_ids:
            return []

        blocker_ids = [UUID(bid) for bid in task.blocked_by_task_ids]
        result = await self.session.execute(
            select(Task.id, Task.title, Task.status, Task.number).where(
                and_(
                    Task.id.in_(blocker_ids),
                    Task.project_id == task.project_id,
                    Task.is_deleted == False,  # noqa: E712
                    Task.completed_at.is_(None),
                )
            )
        )
        unresolved = result.all()
        return [
            {
                "id": str(row.id),
                "title": row.title,
                "status": row.status,
                "number": str(row.number),
            }
            for row in unresolved
        ]

    async def validate_in_project(
        self, project_id: UUID, task_ids: list[UUID], field_name: str
    ) -> None:
        """Parents and blockers are tasks of the same project; a deleted one still counts, so an
        edit that keeps a blocker deleted since is not refused.
        """
        wanted = set(task_ids)
        if not wanted:
            return
        result = await self.session.execute(
            select(Task.id).where(and_(Task.id.in_(wanted), Task.project_id == project_id))
        )
        if wanted - set(result.scalars().all()):
            raise ValidationError(field_name, "Link only tasks of this project")

    async def validate_no_circular_dependency(
        self,
        task_id: UUID,
        blocked_by_task_ids: list[str],
    ) -> None:
        task_id_str = str(task_id)
        if task_id_str in blocked_by_task_ids:
            raise ValidationError("blocked_by", "A task cannot be blocked by itself")

        visited: set[str] = set()
        queue = list(blocked_by_task_ids)
        depth = 0
        max_depth = 20

        while queue and depth < max_depth:
            depth += 1
            current_ids = [UUID(tid) for tid in queue if tid not in visited]
            if not current_ids:
                break

            for tid_str in queue:
                visited.add(tid_str)

            result = await self.session.execute(
                select(Task.id, Task.blocked_by_task_ids).where(
                    and_(
                        Task.id.in_(current_ids),
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
            )
            rows = result.all()

            queue = []
            for row in rows:
                if row.blocked_by_task_ids:
                    for upstream_id in row.blocked_by_task_ids:
                        if upstream_id == task_id_str:
                            raise ValidationError(
                                "blocked_by",
                                "These tasks already depend on each other. "
                                "Adding this link would create a loop",
                            )
                        if upstream_id not in visited:
                            queue.append(upstream_id)

    async def validate_no_circular_parent(
        self,
        task_id: UUID | None,
        proposed_parent_id: UUID,
    ) -> None:
        """Reject self-parent, parent cycles, and chains deeper than 5."""
        if task_id is not None and task_id == proposed_parent_id:
            raise ValidationError("parent_id", "A task cannot be its own parent")

        max_depth = 5
        depth = 1
        current: UUID | None = proposed_parent_id
        visited: set[UUID] = set()

        while current is not None:
            if current in visited:
                raise ValidationError("parent_id", "Parent chain already contains a cycle")
            visited.add(current)

            if depth > max_depth:
                raise ValidationError("parent_id", f"Maximum nesting depth is {max_depth}")

            result = await self.session.execute(
                select(Task.parent_id).where(
                    and_(
                        Task.id == current,
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
            )
            next_parent = result.scalar_one_or_none()
            if next_parent is None:
                return

            if task_id is not None and next_parent == task_id:
                raise ValidationError(
                    "parent_id",
                    "These tasks already depend on each other. "
                    "Adding this parent would create a loop",
                )

            current = next_parent
            depth += 1

    async def validate_field_values(
        self,
        project_id: UUID,
        field_values: dict | None,
        task_type: str | None = None,
    ) -> None:
        field_defs = await queries.get_fields_for_project(self.session, project_id)

        type_field_schemas = None
        if task_type:
            result = await self.session.get(Project, project_id)
            if result:
                type_field_schemas = result.type_field_schemas

        errors = validate_field_values(
            field_values or {},
            field_defs,
            task_type=task_type,
            type_field_schemas=type_field_schemas,
        )
        if errors:
            raise ValidationError("field_values", "; ".join(errors))
