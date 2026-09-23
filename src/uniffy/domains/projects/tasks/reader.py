"""Task query and listing operations."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Select, and_, func, select
from uniffy_proto.projects.v1.projects_pb2 import TaskFilterGroup, TaskSort

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.queries import get_fields_for_project, get_views_for_project
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.filtering import FilterContext, TaskFilterCompiler
from uniffy.domains.projects.tasks.sorting import apply_task_sort
from uniffy.domains.projects.views.definition import (
    MAX_VIEW_NAME_LENGTH,
    definition_from_dict,
    validate_task_filter,
    validate_task_sort,
)
from uniffy.domains.settings.operations import get_user_calendar_preferences

# The longest IANA zone name is 32 characters.
_MAX_ZONE_LENGTH = 64


class TaskReader(TaskContentOperations):
    async def list_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_deleted: bool = False,
        parent_id: UUID | None = None,
        task_filter: TaskFilterGroup | None = None,
        sort: Sequence[TaskSort] | None = None,
        view: str | None = None,
        time_zone: str | None = None,
        page: int = 1,
        page_size: int = 500,
        now: datetime | None = None,
    ) -> tuple[list[Task], int]:
        """``task_filter`` and ``sort`` follow a saved view's rules; ``view`` names a saved view,
        by id or name, whose filter and sort apply where those are None. ``time_zone`` is the
        caller's clock, used when their profile names no usable zone.
        """
        query = await self.list_query(
            user_id,
            organization_id,
            project_id,
            include_deleted=include_deleted,
            parent_id=parent_id,
            task_filter=task_filter,
            sort=sort,
            view=view,
            time_zone=time_zone,
            now=now,
        )
        result = await self.session.execute(query.offset((page - 1) * page_size).limit(page_size))
        tasks = list(result.scalars().all())
        if page == 1 and len(tasks) < page_size:
            return tasks, len(tasks)
        count_result = await self.session.execute(
            select(func.count()).select_from(query.order_by(None).subquery())
        )
        return tasks, count_result.scalar_one()

    async def list_query(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        *,
        include_deleted: bool = False,
        parent_id: UUID | None = None,
        task_filter: TaskFilterGroup | None = None,
        sort: Sequence[TaskSort] | None = None,
        view: str | None = None,
        time_zone: str | None = None,
        now: datetime | None = None,
    ) -> Select[tuple[Task]]:
        """The ordered, unpaged task query ``list_tasks`` runs, after the project access check."""
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
        if parent_id is not None:
            query = query.where(Task.parent_id == parent_id)

        stored_filter = stored_sort = False
        if view is not None:
            view_filter, view_sort = await self._view_query(user_id, project_id, view)
            if task_filter is None:
                task_filter, stored_filter = view_filter, True
            if sort is None:
                sort, stored_sort = view_sort, True
        has_filter = task_filter is not None and len(task_filter.nodes) > 0
        if not has_filter and not sort:
            return query.order_by(Task.sort_order.asc(), Task.number.asc(), Task.id.asc())

        fields = await get_fields_for_project(self.session, project_id)
        keys = validate_task_sort(sort or (), fields, stored=stored_sort)
        ctx = await self._filter_context(
            user_id, organization_id, project_id, fields, time_zone, now
        )
        compiler = TaskFilterCompiler(ctx)
        if has_filter:
            checked = validate_task_filter(task_filter, fields, stored=stored_filter)
            query = query.where(compiler.compile(checked))
        return apply_task_sort(query, keys, compiler)

    async def _view_query(
        self, user_id: UUID, project_id: UUID, view: str
    ) -> tuple[TaskFilterGroup | None, list[TaskSort]]:
        """The filter and sort of a saved view the caller can see, named by id or by name."""
        views = await get_views_for_project(self.session, project_id, user_id)
        wanted = view.strip().casefold()
        match = next((row for row in views if row.id == view), None) or next(
            (row for row in views if row.name.casefold() == wanted), None
        )
        if match is None:
            known = ", ".join(f"{row.name} ({row.id})" for row in views)
            raise ValidationError(
                "view", f"No view '{view[:MAX_VIEW_NAME_LENGTH]}' in this project. Views: {known}"
            )
        definition = definition_from_dict(match.definition, match.type)
        task_filter = definition.filter if definition.HasField("filter") else None
        return task_filter, list(definition.sort)

    async def _filter_context(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        fields: list[FieldDefinition],
        time_zone: str | None,
        now: datetime | None,
    ) -> FilterContext:
        preferences = await get_user_calendar_preferences(self.session, user_id)
        # A stored zone this server does not know falls back as an unset one does; only a zone
        # the request itself names is refused.
        zone = _known_zone(preferences.timezone) or _request_zone(time_zone)
        active_sprint = await self.session.execute(
            select(Sprint.id)
            .where(
                and_(
                    Sprint.project_id == project_id,
                    Sprint.organization_id == organization_id,
                    Sprint.status == SprintStatus.ACTIVE,
                )
            )
            .order_by(Sprint.sort_order.asc())
            .limit(1)
        )
        return FilterContext(
            organization_id=organization_id,
            project_id=project_id,
            current_user_id=user_id,
            active_sprint_id=active_sprint.scalar_one_or_none(),
            today=(now or datetime.now(UTC)).astimezone(zone).date(),
            week_start=preferences.week_start,
            zone=zone,
            fields={field.id: field for field in fields},
        )


def _known_zone(name: str | None) -> ZoneInfo | None:
    if not name or len(name) > _MAX_ZONE_LENGTH:
        return None
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError:
        return None


def _request_zone(name: str | None) -> ZoneInfo:
    if not name:
        return ZoneInfo("UTC")
    zone = _known_zone(name)
    if zone is None:
        raise ValidationError("time_zone", f"Unknown time zone '{name[:_MAX_ZONE_LENGTH]}'")
    return zone
