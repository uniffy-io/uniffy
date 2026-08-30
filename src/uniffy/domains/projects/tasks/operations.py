"""Public task operations façade and task listing."""

from enum import StrEnum
from uuid import UUID

from sqlalchemy import and_, func, literal, not_, select

from uniffy.core.models.projects.task import Task
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.creation import TaskCreateOperations
from uniffy.domains.projects.tasks.mutations import TaskMutationOperations


class ProjectTagFilterMode(StrEnum):
    ALL = "all"
    ANY = "any"
    NONE = "none"


class TaskOperations(TaskContentOperations):
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

    async def list_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_deleted: bool = False,
        parent_id: UUID | None = None,
        sprint_id: UUID | None = None,
        backlog_only: bool = False,
        tag_ids: list[UUID] | None = None,
        tag_filter_mode: ProjectTagFilterMode = ProjectTagFilterMode.ALL,
        in_epic_id: UUID | None = None,
        root_only: bool = False,
        has_subtasks: bool | None = None,
        min_depth: int | None = None,
        max_depth: int | None = None,
        page: int = 1,
        page_size: int = 500,
    ) -> tuple[list[Task], int]:
        """``tag_filter_mode`` is ``all``/``any``/``none``; epic/depth
        filters use a recursive ancestry CTE.
        """
        project_ops = ProjectOperations(self.session)
        await project_ops.get_by_id(user_id, organization_id, project_id)

        query = select(Task).where(
            and_(
                Task.project_id == project_id,
                Task.organization_id == organization_id,
            )
        )

        if not include_deleted:
            query = query.where(Task.is_deleted == False)  # noqa: E712

        if root_only:
            query = query.where(Task.parent_id.is_(None))
        elif parent_id is not None:
            query = query.where(Task.parent_id == parent_id)

        if sprint_id is not None:
            query = query.where(Task.sprint_id == sprint_id)
        elif backlog_only:
            query = query.where(Task.sprint_id.is_(None))

        if tag_ids:
            mode = ProjectTagFilterMode(tag_filter_mode or ProjectTagFilterMode.ALL)
            if mode is ProjectTagFilterMode.ANY:
                query = query.where(Task.id.in_(self._tag_any_subquery(tag_ids)))
            elif mode is ProjectTagFilterMode.NONE:
                query = query.where(not_(Task.id.in_(self._tag_any_subquery(tag_ids))))
            else:
                query = query.where(Task.id.in_(self._tag_filter_subquery(tag_ids)))

        if has_subtasks is not None:
            child_exists = (
                select(Task.id)
                .where(
                    and_(
                        Task.parent_id.is_not(None),
                        Task.organization_id == organization_id,
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
                .distinct()
            )
            if has_subtasks:
                query = query.where(Task.id.in_(child_exists.with_only_columns(Task.parent_id)))
            else:
                query = query.where(
                    not_(Task.id.in_(child_exists.with_only_columns(Task.parent_id)))
                )

        needs_ancestry = in_epic_id is not None or min_depth is not None or max_depth is not None
        if needs_ancestry:
            ancestry = self._build_ancestry_cte(project_id, organization_id)
            ancestry_filter = select(ancestry.c.task_id)
            if in_epic_id is not None:
                ancestry_filter = ancestry_filter.where(ancestry.c.ancestor_id == in_epic_id)
            if min_depth is not None or max_depth is not None:
                depth_per_task = select(ancestry.c.task_id).group_by(ancestry.c.task_id)
                conditions = []
                if min_depth is not None:
                    conditions.append(func.max(ancestry.c.depth) >= min_depth)
                if max_depth is not None:
                    conditions.append(func.max(ancestry.c.depth) <= max_depth)
                depth_per_task = depth_per_task.having(and_(*conditions))
                query = query.where(Task.id.in_(depth_per_task))
            if in_epic_id is not None:
                query = query.where(Task.id.in_(ancestry_filter))

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Task.sort_order.asc(), Task.created_at.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    def _build_ancestry_cte(self, project_id: UUID, organization_id: UUID):
        """Emits ``(task_id, ancestor_id, depth)`` per ancestor, with depth
        0 marking the task itself.
        """
        task_alias = Task.__table__.alias("t_anchor")
        base = select(
            task_alias.c.id.label("task_id"),
            task_alias.c.id.label("ancestor_id"),
            task_alias.c.parent_id.label("next_parent_id"),
            literal(0).label("depth"),
        ).where(
            and_(
                task_alias.c.project_id == project_id,
                task_alias.c.organization_id == organization_id,
                task_alias.c.is_deleted == False,  # noqa: E712
            )
        )
        ancestry = base.cte(name="task_ancestry", recursive=True)

        parent_alias = Task.__table__.alias("t_parent")
        recursive = (
            select(
                ancestry.c.task_id,
                parent_alias.c.id.label("ancestor_id"),
                parent_alias.c.parent_id.label("next_parent_id"),
                (ancestry.c.depth + 1).label("depth"),
            )
            .select_from(ancestry.join(parent_alias, parent_alias.c.id == ancestry.c.next_parent_id))
            .where(
                and_(
                    parent_alias.c.organization_id == organization_id,
                    parent_alias.c.is_deleted == False,  # noqa: E712
                )
            )
        )
        return ancestry.union_all(recursive)
