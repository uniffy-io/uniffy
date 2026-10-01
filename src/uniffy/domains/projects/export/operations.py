"""Streaming export of project tasks: one project or several, whole or narrowed to a view."""

from collections.abc import AsyncIterator, Sequence
from uuid import UUID

from loguru import logger
from sqlalchemy import CTE, Select, and_, func, literal, select, union_all
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb import TaskSort

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.projects.export.bundle import stream_bundle
from uniffy.domains.projects.export.labels import ExportLabels
from uniffy.domains.projects.export.plan import ExportLayout, ExportPlan, ExportRequest
from uniffy.domains.projects.export.rows import (
    EXPORT_BATCH,
    MAX_EXPORT_PROJECTS,
    MAX_EXPORT_ROWS,
    TASK_COLUMNS,
    CsvChunker,
    CustomColumn,
    build_custom_columns,
    task_row,
)
from uniffy.domains.projects.tasks.expressions import MAX_ANCESTRY_DEPTH
from uniffy.domains.projects.tasks.reader import TaskReader

logger = logger.bind(component="projects.export.operations")


class ProjectExportOperations:
    """Reads only. Give it a session nothing else has used, so `prepare` can pin the snapshot."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def prepare(self, user_id: UUID, request: ExportRequest) -> ExportPlan:
        """Authorize every project and enforce the row cap before a byte is produced."""
        project_ids = list(dict.fromkeys(request.project_ids))
        if not project_ids:
            raise ValidationError("project_ids", "Choose at least one project to export.")
        if len(project_ids) > MAX_EXPORT_PROJECTS:
            raise ValidationError(
                "project_ids", f"Export at most {MAX_EXPORT_PROJECTS} projects at a time."
            )
        if len(project_ids) > 1 and request.narrowed:
            raise ValidationError(
                "project_ids", "Filters, sorts and views apply to a single project export."
            )

        # One snapshot for every file of the export, so a bundle never names a task its
        # tasks.csv lacks. It has to be set before the session's first statement.
        await self.session.connection(
            execution_options={"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}
        )
        projects = await self._viewable_projects(user_id, request.organization_id, project_ids)

        plan = ExportPlan(user_id=user_id, request=request, projects=projects)
        reader = TaskReader(self.session)
        # An empty sort lets a named view's own sort apply.
        sort: list[TaskSort] | None = list(request.sort) or (None if request.view_id else [])
        for project in projects:
            query = await reader.list_query(
                user_id,
                request.organization_id,
                project.id,
                task_filter=request.task_filter,
                sort=sort,
                view=request.view_id,
                time_zone=request.time_zone,
            )
            if request.layout is ExportLayout.OUTLINE:
                query = query.where(Task.parent_id.is_(None))
                tree = _outline_tree(project, _ids(query), "export_outline")
                count = select(func.count()).select_from(tree)
            else:
                count = select(func.count()).select_from(query.order_by(None).subquery())
            plan.row_counts[project.id] = (await self.session.execute(count)).scalar_one()
            plan.queries[project.id] = query

        if plan.row_count > MAX_EXPORT_ROWS:
            raise ValidationError(
                "filter",
                f"This export would include {plan.row_count:,} tasks, over the "
                f"{MAX_EXPORT_ROWS:,} limit. Narrow the filter or export fewer projects.",
            )
        return plan

    async def stream(self, plan: ExportPlan) -> AsyncIterator[bytes]:
        labels = ExportLabels(self.session, plan.request.organization_id, plan.user_id)
        fields_by_project = await labels.load_projects(plan.projects)
        custom = build_custom_columns(plan.projects, fields_by_project)
        tasks_csv = self._tasks_csv(plan, labels, custom)
        if not plan.request.include_bundle:
            async for chunk in tasks_csv:
                yield chunk
            return
        bundle = stream_bundle(self.session, plan, labels, tasks_csv, self._exported_ids(plan))
        async for chunk in bundle:
            yield chunk

    async def _tasks_csv(
        self, plan: ExportPlan, labels: ExportLabels, custom: Sequence[CustomColumn]
    ) -> AsyncIterator[bytes]:
        chunker = CsvChunker()
        if chunk := chunker.header([*TASK_COLUMNS, *(column.header for column in custom)]):
            yield chunk
        for project in plan.projects:
            query = plan.queries[project.id]
            if plan.request.layout is ExportLayout.OUTLINE:
                batches = self._outline_batches(project, query)
            else:
                batches = self._flat_batches(query)
            async for batch in batches:
                await labels.load_tasks(project.id, batch)
                for task in batch:
                    if chunk := chunker.row(task_row(task, project, labels, custom)):
                        yield chunk
        if chunk := chunker.flush():
            yield chunk

    def _exported_ids(self, plan: ExportPlan) -> Select:
        """Ids of every exported task, read in the same snapshot as tasks.csv."""
        selects: list[Select] = []
        for index, project in enumerate(plan.projects):
            query = plan.queries[project.id]
            if plan.request.layout is ExportLayout.OUTLINE:
                tree = _outline_tree(project, _ids(query), f"export_outline_{index}")
                selects.append(select(tree.c.task_id))
            else:
                selects.append(_ids(query))
        if len(selects) == 1:
            return selects[0]
        exported = union_all(*selects).subquery("exported_tasks")
        return select(exported.c[0])

    async def _viewable_projects(
        self, user_id: UUID, organization_id: UUID, project_ids: list[UUID]
    ) -> list[Project]:
        access_filter = await ContentAccessQuery(self.session).build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROJECT,
            content_id_column=Project.id,
            owner_id_column=Project.owner_id,
            access_mode_column=Project.access_mode,
            baseline_role_column=Project.baseline_role,
        )
        result = await self.session.execute(
            select(Project).where(
                and_(
                    Project.organization_id == organization_id,
                    Project.id.in_(project_ids),
                    Project.is_deleted == False,  # noqa: E712
                    access_filter,
                )
            )
        )
        projects = list(result.scalars().all())
        if len(projects) != len(project_ids):
            # A missing project and a hidden one read the same, and neither is named.
            raise PermissionDeniedError("export", ContentType.PROJECT.value)
        return sorted(projects, key=lambda project: (project.name.casefold(), str(project.id)))

    async def _flat_batches(self, query: Select) -> AsyncIterator[list[Task]]:
        rows = await self.session.stream_scalars(query.execution_options(yield_per=EXPORT_BATCH))
        try:
            async for partition in rows.partitions(EXPORT_BATCH):
                yield list(partition)
        finally:
            await rows.close()

    async def _outline_batches(self, project: Project, roots: Select) -> AsyncIterator[list[Task]]:
        """Each root followed depth-first by all its live children, siblings by number, the way
        the outline table nests them."""
        rows = await self.session.stream_scalars(roots.execution_options(yield_per=EXPORT_BATCH))
        try:
            async for partition in rows.partitions(EXPORT_BATCH):
                children = await self._descendants(project, [root.id for root in partition])
                ordered: list[Task] = []
                for root in partition:
                    ordered.append(root)
                    ordered.extend(children.get(root.id, []))
                for start in range(0, len(ordered), EXPORT_BATCH):
                    yield ordered[start : start + EXPORT_BATCH]
        finally:
            await rows.close()

    async def _descendants(self, project: Project, root_ids: list[UUID]) -> dict[UUID, list[Task]]:
        tree = _outline_tree(project, root_ids, "export_outline")
        result = await self.session.execute(
            select(Task, tree.c.root_id)
            .join(tree, tree.c.task_id == Task.id)
            .where(tree.c.depth > 0)
            .order_by(tree.c.root_id, tree.c.path)
        )
        grouped: dict[UUID, list[Task]] = {}
        for task, root_id in result.all():
            grouped.setdefault(root_id, []).append(task)
        return grouped


def _ids(query: Select) -> Select:
    return query.order_by(None).with_only_columns(Task.id)


def _outline_tree(project: Project, seed: Select | list[UUID], name: str) -> CTE:
    """``(task_id, root_id, depth, path)`` for the seed tasks and every live descendant."""
    anchor = Task.__table__.alias(f"{name}_anchor")
    tree = (
        select(
            anchor.c.id.label("task_id"),
            anchor.c.id.label("root_id"),
            literal(0).label("depth"),
            postgresql.array([anchor.c.number]).label("path"),
        )
        .where(anchor.c.id.in_(seed))
        .cte(name=name, recursive=True)
    )
    child = Task.__table__.alias(f"{name}_child")
    return tree.union_all(
        select(
            child.c.id,
            tree.c.root_id,
            tree.c.depth + 1,
            func.array_append(tree.c.path, child.c.number),
        )
        .select_from(tree.join(child, child.c.parent_id == tree.c.task_id))
        .where(
            and_(
                child.c.project_id == project.id,
                child.c.organization_id == project.organization_id,
                child.c.is_deleted == False,  # noqa: E712
                tree.c.depth < MAX_ANCESTRY_DEPTH,
            )
        )
    )


async def record_export(session: AsyncSession, user_id: UUID, plan: ExportPlan) -> None:
    """One audit row per exported project; call it on its own session, the export is read only."""
    request = plan.request
    for project in plan.projects:
        await write_audit_event(
            session,
            organization_id=request.organization_id,
            actor_user_id=user_id,
            action=Action.PROJECT_EXPORTED,
            resource_type=AuditResourceType.PROJECT,
            resource_id=project.id,
            details={
                "rows": plan.row_counts.get(project.id, 0),
                "projects": len(plan.projects),
                "scope": request.scope.value,
                "bundle": request.include_bundle,
            },
        )
    await session.commit()
    logger.info(
        "project export started",
        organization_id=str(request.organization_id),
        projects=len(plan.projects),
        rows=plan.row_count,
        bundle=request.include_bundle,
    )
