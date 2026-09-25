from datetime import UTC, datetime
from typing import NamedTuple
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from uniffy_proto.common.v1.common_pb import PaginationResponse
from uniffy_proto.projects.v1.projects_pb import (
    BulkCheckTaskWatchersRequest,
    BulkCheckTaskWatchersResponse,
    BulkUpdateTasksRequest,
    BulkUpdateTasksResponse,
    CompleteSprintRequest,
    CompleteSprintResponse,
    CreateFieldRequest,
    CreateFieldResponse,
    CreateProjectRequest,
    CreateProjectResponse,
    CreateSprintRequest,
    CreateSprintResponse,
    CreateTaskRequest,
    CreateTaskResponse,
    DeleteFieldRequest,
    DeleteFieldResponse,
    DeleteProjectRequest,
    DeleteProjectResponse,
    DeleteSprintRequest,
    DeleteSprintResponse,
    DeleteTaskRequest,
    DeleteTaskResponse,
    DeleteTasksRequest,
    DeleteTasksResponse,
    GetProjectRequest,
    GetProjectResponse,
    GetTaskRequest,
    GetTaskResponse,
    ListActivitiesRequest,
    ListActivitiesResponse,
    ListProjectsRequest,
    ListProjectsResponse,
    ListSprintsRequest,
    ListSprintsResponse,
    ListTasksRequest,
    ListTasksResponse,
    ListTaskWatchersRequest,
    ListTaskWatchersResponse,
    MoveTaskRequest,
    MoveTaskResponse,
    StartSprintRequest,
    StartSprintResponse,
    ToggleTaskWatcherRequest,
    ToggleTaskWatcherResponse,
    UpdateFieldRequest,
    UpdateFieldResponse,
    UpdateProjectRequest,
    UpdateProjectResponse,
    UpdateSprintRequest,
    UpdateSprintResponse,
    UpdateTaskRequest,
    UpdateTaskResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.models.projects.field_definition import FieldDefinition, SystemProjectFieldId
from uniffy.core.models.projects.project import Project
from uniffy.core.models.tags.tag import Tag
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.projects import queries
from uniffy.domains.projects.converters import (
    activity_to_proto,
    field_to_proto,
    field_type_from_proto,
    project_to_proto,
    sprint_to_proto,
    task_to_proto,
)
from uniffy.domains.projects.fields import DEFAULT_CUSTOM_FIELD_SORT_ORDER
from uniffy.domains.projects.operations import (
    FieldOperations,
    ProjectOperations,
    SprintOperations,
    TaskOperations,
    TaskReader,
    WatcherOperations,
)
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.status_colors import assign_status_colors
from uniffy.domains.projects.statuses import (
    ensure_removed_statuses_unused,
    parse_task_status_semantics,
)
from uniffy.domains.tags.reader import TagReader
from uniffy.infrastructure.database import open_session


def _parse_tag_ids(raw_ids) -> list[UUID]:
    out: list[UUID] = []
    for raw in raw_ids or ():
        try:
            out.append(UUID(raw))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid tag_id") from exc
    return out


async def _hydrate_task_tags(
    session: AsyncSession,
    organization_id: UUID,
    task_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    if not task_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.TASK, tid): tid for tid in task_ids}
    tag_ops = TagReader(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {tid: bulk.get(urn, []) for urn, tid in urn_to_id.items()}


async def _hydrate_project_tags(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    if not project_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.PROJECT, pid): pid for pid in project_ids}
    tag_ops = TagReader(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {pid: bulk.get(urn, []) for urn, pid in urn_to_id.items()}


class _ProjectCounts(NamedTuple):
    """Everything `project_to_proto` needs beyond the row itself."""

    task_total: int
    task_done: int
    members: int
    overdue: int
    estimated_minutes: int
    time_spent_minutes: int


class _ProjectRollups(NamedTuple):
    """Per-project counts keyed by project id, all defaulting to zero."""

    tasks: dict[UUID, queries.ProjectTaskRollup]
    members: dict[UUID, int]

    def for_project(self, project_id: UUID) -> _ProjectCounts:
        task = self.tasks.get(project_id)
        return _ProjectCounts(
            task_total=task.total if task else 0,
            task_done=task.completed if task else 0,
            members=self.members.get(project_id, 0),
            overdue=task.overdue if task else 0,
            estimated_minutes=task.estimated_minutes if task else 0,
            time_spent_minutes=task.time_spent_minutes if task else 0,
        )


async def _load_project_rollups(
    session: AsyncSession,
    organization_id: UUID,
    project_ids: list[UUID],
) -> _ProjectRollups:
    return _ProjectRollups(
        tasks=await queries.get_task_rollups_for_projects(session, organization_id, project_ids),
        members=await queries.get_member_counts_for_projects(session, organization_id, project_ids),
    )


async def _resolve_project_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    project: Project,
    checker: PermissionChecker | None = None,
):
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.PROJECT,
    )
    return resolve_effective_policy(
        project.access_mode,
        project.baseline_role,
        default_mode,
        default_baseline,
    )


class ProjectsHandlers:
    async def create_project(
        self,
        request: CreateProjectRequest,
        ctx: RequestContext,
    ) -> CreateProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        slug = request.slug if request.has_field("slug") else None

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.has_field("description") else "",
                    icon=request.icon if request.has_field("icon") else "folder",
                    color=request.color if request.has_field("color") else "#3b82f6",
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    slug=slug,
                    tag_ids=tag_ids or None,
                )
                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                return CreateProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_project", exc) from exc

    async def get_project(
        self,
        request: GetProjectRequest,
        ctx: RequestContext,
    ) -> GetProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await ops.get_by_id(user_id, organization_id, project_id)
                user_role = await ops._resolve_role(user_id, organization_id, project)

                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                rollups = await _load_project_rollups(session, organization_id, [project.id])
                counts = rollups.for_project(project.id)

                return GetProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        task_count=counts.task_total,
                        completed_task_count=counts.task_done,
                        member_count=counts.members,
                        overdue_task_count=counts.overdue,
                        estimated_minutes=counts.estimated_minutes,
                        time_spent_minutes=counts.time_spent_minutes,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_project", exc) from exc

    async def update_project(
        self,
        request: UpdateProjectRequest,
        ctx: RequestContext,
    ) -> UpdateProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        updates: dict = {}
        if request.has_field("name"):
            updates["name"] = request.name
        if request.has_field("description"):
            updates["description"] = request.description
        if request.has_field("icon"):
            updates["icon"] = request.icon
        if request.has_field("color"):
            updates["color"] = request.color
        if request.has_field("default_view_id"):
            updates["default_view_id"] = request.default_view_id
        if request.has_field("slug"):
            updates["slug"] = request.slug
        if request.type_field_schemas:
            updates["type_field_schemas"] = {
                type_name: {
                    "shown_field_ids": list(schema.shown_field_ids),
                    "required_field_ids": list(schema.required_field_ids),
                }
                for type_name, schema in request.type_field_schemas.items()
            }
        if request.has_field("tag_ids"):
            updates["tag_ids"] = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                try:
                    project = await ops.update(user_id, organization_id, project_id, **updates)
                except IntegrityError as exc:
                    raise ConnectError(
                        Code.ALREADY_EXISTS,
                        "A project with that slug already exists",
                    ) from exc

                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                eff_mode, eff_baseline = await _resolve_project_effective_policy(
                    session,
                    organization_id,
                    project,
                )
                rollups = await _load_project_rollups(session, organization_id, [project.id])
                counts = rollups.for_project(project.id)
                return UpdateProjectResponse(
                    project=project_to_proto(
                        project,
                        fields,
                        views,
                        user_role,
                        tags=tags_by_id.get(project.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                        task_count=counts.task_total,
                        completed_task_count=counts.task_done,
                        member_count=counts.members,
                        overdue_task_count=counts.overdue,
                        estimated_minutes=counts.estimated_minutes,
                        time_spent_minutes=counts.time_spent_minutes,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_project", exc) from exc

    async def delete_project(
        self,
        request: DeleteProjectRequest,
        ctx: RequestContext,
    ) -> DeleteProjectResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                await ops.delete(user_id, organization_id, project_id, permanent=request.permanent)
                return DeleteProjectResponse(success=True, message="Project deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_project", exc) from exc

    async def list_projects(
        self,
        request: ListProjectsRequest,
        ctx: RequestContext,
    ) -> ListProjectsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        page = 1
        page_size = 50
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None

        try:
            async with open_session() as session:
                ops = ProjectOperations(session, self.storage, self.search_indexer)
                projects, total = await ops.list_projects(
                    user_id=user_id,
                    organization_id=organization_id,
                    access_mode=access_mode,
                    include_deleted=(
                        request.include_deleted if request.has_field("include_deleted") else False
                    ),
                    page=page,
                    page_size=page_size,
                )

                project_ids = [p.id for p in projects]
                fields_map = await queries.get_fields_for_projects(session, project_ids)
                views_map = await queries.get_views_for_projects(session, project_ids, user_id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, project_ids)
                rollups = await _load_project_rollups(session, organization_id, project_ids)

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.PROJECT,
                )
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[ResourceKey(ContentType.PROJECT, project.id) for project in projects],
                )
                project_protos = []
                for project in projects:
                    user_role = decisions[ResourceKey(ContentType.PROJECT, project.id)].role
                    fields = fields_map.get(str(project.id), [])
                    views = views_map.get(str(project.id), [])
                    eff_mode, eff_baseline = resolve_effective_policy(
                        project.access_mode,
                        project.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    counts = rollups.for_project(project.id)
                    project_protos.append(
                        project_to_proto(
                            project,
                            fields,
                            views,
                            user_role,
                            tags=tags_by_id.get(project.id),
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                            task_count=counts.task_total,
                            completed_task_count=counts.task_done,
                            member_count=counts.members,
                            overdue_task_count=counts.overdue,
                            estimated_minutes=counts.estimated_minutes,
                            time_spent_minutes=counts.time_spent_minutes,
                        )
                    )

                total_pages = (total + page_size - 1) // page_size

                return ListProjectsResponse(
                    projects=project_protos,
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_projects", exc) from exc

    async def create_task(
        self,
        request: CreateTaskRequest,
        ctx: RequestContext,
    ) -> CreateTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        kwargs: dict = {
            "description": request.description if request.has_field("description") else "",
            "status": request.status if request.has_field("status") else "status_todo",
            "priority": (request.priority if request.has_field("priority") else "priority_medium"),
            "task_type": request.task_type if request.has_field("task_type") else "task",
        }

        if request.assignee_ids:
            kwargs["assignee_ids"] = list(request.assignee_ids)
        if request.has_field("start_date"):
            kwargs["start_date"] = request.start_date
        if request.has_field("due_date"):
            kwargs["due_date"] = request.due_date
        if request.has_field("parent_id"):
            kwargs["parent_id"] = (
                parse_uuid(request.parent_id, "parent_id") if request.parent_id else None
            )
        if request.blocked_by_task_ids:
            kwargs["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
        if request.has_field("is_milestone"):
            kwargs["is_milestone"] = request.is_milestone
        if request.has_field("recurrence_rule"):
            kwargs["recurrence_rule"] = request.recurrence_rule
        if request.has_field("sprint_id"):
            kwargs["sprint_id"] = (
                parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )
        if request.has_field("estimated_minutes"):
            kwargs["estimated_minutes"] = request.estimated_minutes or None
        if request.has_field("time_spent_minutes"):
            kwargs["time_spent_minutes"] = request.time_spent_minutes or None
        if request.field_values:
            field_values: dict = {}
            for key, value in request.field_values.items():
                try:
                    field_values[key] = loads(value)
                except ValueError:
                    field_values[key] = value
            kwargs["field_values"] = field_values

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    title=request.title,
                    task_type=kwargs.pop("task_type", "task"),
                    tag_ids=tag_ids or None,
                    **kwargs,
                )

                user_role = await ops._resolve_role(user_id, organization_id, task)

                hydrate_ids = [task.id]
                if task.parent_id:
                    hydrate_ids.append(task.parent_id)
                tags_by_id = await _hydrate_task_tags(session, organization_id, hydrate_ids)

                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent,
                        user_role,
                        subtask_total=p_total,
                        subtask_completed=p_done,
                        tags=tags_by_id.get(parent.id),
                    )

                return CreateTaskResponse(
                    task=task_to_proto(task, user_role, tags=tags_by_id.get(task.id)),
                    updated_parent=updated_parent_proto,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_task", exc) from exc

    async def get_task(
        self,
        request: GetTaskRequest,
        ctx: RequestContext,
    ) -> GetTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskReader(session)
                task = await ops.get_by_id(user_id, organization_id, task_id)
                user_role = await ops._resolve_role(user_id, organization_id, task)

                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))
                tags_by_id = await _hydrate_task_tags(session, organization_id, [task.id])

                return GetTaskResponse(
                    task=task_to_proto(
                        task, user_role, st_total, st_done, tags=tags_by_id.get(task.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_task", exc) from exc

    async def update_task(
        self,
        request: UpdateTaskRequest,
        ctx: RequestContext,
    ) -> UpdateTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        updates: dict = {}
        if request.has_field("title"):
            updates["title"] = request.title
        if request.has_field("description"):
            updates["description"] = request.description
        if request.has_field("status"):
            updates["status"] = request.status
        if request.has_field("priority"):
            updates["priority"] = request.priority
        if request.has_field("assignee_ids"):
            updates["assignee_ids"] = list(request.assignee_ids.ids)
        if request.has_field("start_date"):
            updates["start_date"] = request.start_date or None
        if request.has_field("due_date"):
            updates["due_date"] = request.due_date or None
        if request.has_field("parent_id"):
            updates["parent_id"] = (
                parse_uuid(request.parent_id, "parent_id") if request.parent_id else None
            )
        if request.blocked_by_task_ids:
            updates["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
        if request.has_field("is_milestone"):
            updates["is_milestone"] = request.is_milestone
        if request.has_field("recurrence_rule"):
            updates["recurrence_rule"] = request.recurrence_rule
        if request.has_field("sort_order"):
            updates["sort_order"] = request.sort_order
        if request.has_field("task_type"):
            updates["task_type"] = request.task_type
        if request.has_field("sprint_id"):
            updates["sprint_id"] = (
                parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )
        if request.has_field("estimated_minutes"):
            updates["estimated_minutes"] = request.estimated_minutes or None
        if request.has_field("time_spent_minutes"):
            updates["time_spent_minutes"] = request.time_spent_minutes or None
        if request.field_values:
            field_values: dict = {}
            for key, value in request.field_values.items():
                try:
                    field_values[key] = loads(value)
                except ValueError:
                    field_values[key] = value
            updates["field_values"] = field_values
        if request.has_field("tag_ids"):
            updates["tag_ids"] = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task, spawned_task = await ops.update(user_id, organization_id, task_id, **updates)

                user_role = await ops._resolve_role(user_id, organization_id, task)

                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))

                hydrate_ids = [task.id]
                if task.parent_id:
                    hydrate_ids.append(task.parent_id)
                if spawned_task:
                    hydrate_ids.append(spawned_task.id)
                tags_by_id = await _hydrate_task_tags(session, organization_id, hydrate_ids)

                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent,
                        user_role,
                        subtask_total=p_total,
                        subtask_completed=p_done,
                        tags=tags_by_id.get(parent.id),
                    )

                spawned_proto = (
                    task_to_proto(spawned_task, user_role, tags=tags_by_id.get(spawned_task.id))
                    if spawned_task
                    else None
                )

                return UpdateTaskResponse(
                    task=task_to_proto(
                        task,
                        user_role,
                        subtask_total=st_total,
                        subtask_completed=st_done,
                        tags=tags_by_id.get(task.id),
                    ),
                    updated_parent=updated_parent_proto,
                    spawned_task=spawned_proto,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_task", exc) from exc

    async def move_task(
        self,
        request: MoveTaskRequest,
        ctx: RequestContext,
    ) -> MoveTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                task, spawned_task = await ops.move(
                    user_id,
                    organization_id,
                    task_id,
                    request.status,
                    request.sort_order,
                )

                user_role = await ops._resolve_role(user_id, organization_id, task)

                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))

                hydrate_ids = [task.id]
                if task.parent_id:
                    hydrate_ids.append(task.parent_id)
                if spawned_task:
                    hydrate_ids.append(spawned_task.id)
                tags_by_id = await _hydrate_task_tags(session, organization_id, hydrate_ids)

                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent,
                        user_role,
                        subtask_total=p_total,
                        subtask_completed=p_done,
                        tags=tags_by_id.get(parent.id),
                    )

                spawned_proto = (
                    task_to_proto(spawned_task, user_role, tags=tags_by_id.get(spawned_task.id))
                    if spawned_task
                    else None
                )

                return MoveTaskResponse(
                    task=task_to_proto(
                        task,
                        user_role,
                        subtask_total=st_total,
                        subtask_completed=st_done,
                        tags=tags_by_id.get(task.id),
                    ),
                    updated_parent=updated_parent_proto,
                    spawned_task=spawned_proto,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("move_task", exc) from exc

    async def bulk_update_tasks(
        self,
        request: BulkUpdateTasksRequest,
        ctx: RequestContext,
    ) -> BulkUpdateTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        changes: dict = {}
        if request.has_field("status"):
            changes["status"] = request.status
        if request.has_field("priority"):
            changes["priority"] = request.priority
        if request.assignee_ids:
            changes["assignee_ids"] = list(request.assignee_ids)
        if request.has_field("sprint_id"):
            changes["sprint_id"] = (
                parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                tasks = await ops.bulk_update(
                    user_id,
                    organization_id,
                    list(request.task_ids),
                    **changes,
                )

                user_role = None
                if tasks:
                    user_role = await ops._resolve_role(user_id, organization_id, tasks[0])

                tags_by_id = await _hydrate_task_tags(
                    session, organization_id, [t.id for t in tasks]
                )

                return BulkUpdateTasksResponse(
                    tasks=[task_to_proto(t, user_role, tags=tags_by_id.get(t.id)) for t in tasks],
                    updated_count=len(tasks),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("bulk_update_tasks", exc) from exc

    async def delete_task(
        self,
        request: DeleteTaskRequest,
        ctx: RequestContext,
    ) -> DeleteTaskResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                await ops.delete(user_id, organization_id, task_id, permanent=request.permanent)
                return DeleteTaskResponse(success=True, message="Task deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_task", exc) from exc

    async def delete_tasks(
        self,
        request: DeleteTasksRequest,
        ctx: RequestContext,
    ) -> DeleteTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(
                    session,
                    storage=self.storage,
                    search_indexer=self.search_indexer,
                )
                count = 0
                for task_id_str in request.task_ids:
                    try:
                        task_id = UUID(task_id_str)
                        await ops.delete(
                            user_id, organization_id, task_id, permanent=request.permanent
                        )
                        count += 1
                    except NotFoundError, PermissionDeniedError, ValueError:
                        continue
                return DeleteTasksResponse(success=True, deleted_count=count)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_tasks", exc) from exc

    async def list_tasks(
        self,
        request: ListTasksRequest,
        ctx: RequestContext,
    ) -> ListTasksResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        page = 1
        page_size = 500
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 500,
                1000,
            )

        parent_id: UUID | None = None
        if request.has_field("parent_id") and request.parent_id:
            parent_id = parse_uuid(request.parent_id, "parent_id")

        try:
            async with open_session() as session:
                ops = TaskReader(session)
                tasks, total = await ops.list_tasks(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_deleted=(
                        request.include_deleted if request.has_field("include_deleted") else False
                    ),
                    parent_id=parent_id,
                    task_filter=request.filter if request.has_field("filter") else None,
                    sort=list(request.sort),
                    time_zone=request.time_zone if request.has_field("time_zone") else None,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                project_ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                user_role = await project_ops._resolve_role(user_id, organization_id, project)

                task_ids = [t.id for t in tasks]
                subtask_counts = await queries.get_subtask_counts(session, task_ids)
                tags_by_id = await _hydrate_task_tags(session, organization_id, task_ids)

                task_protos = []
                for t in tasks:
                    st_total, st_done = subtask_counts.get(t.id, (0, 0))
                    task_protos.append(
                        task_to_proto(
                            t,
                            user_role,
                            subtask_total=st_total,
                            subtask_completed=st_done,
                            tags=tags_by_id.get(t.id),
                        )
                    )

                return ListTasksResponse(
                    tasks=task_protos,
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_tasks", exc) from exc

    async def create_field(
        self,
        request: CreateFieldRequest,
        ctx: RequestContext,
    ) -> CreateFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        config: dict = {}
        if request.has_field("config_json"):
            try:
                config = loads(request.config_json)
            except JSONDecodeError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc

        try:
            async with open_session() as session:
                field = await FieldOperations(session).create(
                    user_id,
                    organization_id,
                    project_id,
                    name=request.name,
                    field_type=field_type_from_proto(request.type),
                    config=config,
                    is_required=request.is_required if request.has_field("is_required") else False,
                    sort_order=(
                        request.sort_order
                        if request.has_field("sort_order")
                        else DEFAULT_CUSTOM_FIELD_SORT_ORDER
                    ),
                )
                return CreateFieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_field", exc) from exc

    async def update_field(
        self,
        request: UpdateFieldRequest,
        ctx: RequestContext,
    ) -> UpdateFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                result = await session.execute(
                    select(FieldDefinition).where(
                        FieldDefinition.id == request.field_id,
                        FieldDefinition.project_id == project_id,
                    )
                )
                field = result.scalar_one_or_none()
                if not field:
                    raise NotFoundError("Field", request.field_id)

                if request.has_field("name"):
                    field.name = request.name
                if request.has_field("is_required"):
                    field.is_required = request.is_required
                if request.has_field("sort_order"):
                    field.sort_order = request.sort_order
                if request.has_field("config_json"):
                    try:
                        config = loads(request.config_json)
                    except JSONDecodeError as exc:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc
                    if field.id == SystemProjectFieldId.STATUS:
                        parse_task_status_semantics(config, require_explicit=True)
                        await ensure_removed_statuses_unused(
                            session, project_id, field.config, config
                        )
                        config = assign_status_colors(config)
                    field.config = config
                    flag_modified(field, "config")

                field.updated_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(field)

                return UpdateFieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_field", exc) from exc

    async def delete_field(
        self,
        request: DeleteFieldRequest,
        ctx: RequestContext,
    ) -> DeleteFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session, self.storage, self.search_indexer)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                result = await session.execute(
                    select(FieldDefinition).where(
                        FieldDefinition.id == request.field_id,
                        FieldDefinition.project_id == project_id,
                    )
                )
                field = result.scalar_one_or_none()
                if not field:
                    raise NotFoundError("Field", request.field_id)

                if field.is_system:
                    raise ValidationError("field", "Cannot delete system field")

                await session.delete(field)
                await session.commit()

                return DeleteFieldResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_field", exc) from exc

    async def list_activities(
        self,
        request: ListActivitiesRequest,
        ctx: RequestContext,
    ) -> ListActivitiesResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        page = 1
        page_size = 50
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            if request.pagination.page_size > 0:
                page_size = min(request.pagination.page_size, 200)
            else:
                page_size = 50

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                activities, total = await queries.get_activities_for_task(
                    session,
                    task_id,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListActivitiesResponse(
                    activities=[activity_to_proto(a) for a in activities],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_activities", exc) from exc


class SprintHandlers:
    async def create_sprint(
        self,
        request: CreateSprintRequest,
        ctx: RequestContext,
    ) -> CreateSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    name=request.name,
                    goal=request.goal if request.has_field("goal") else "",
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return CreateSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_sprint", exc) from exc

    async def update_sprint(
        self,
        request: UpdateSprintRequest,
        ctx: RequestContext,
    ) -> UpdateSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    name=request.name if request.has_field("name") else None,
                    goal=request.goal if request.has_field("goal") else None,
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return UpdateSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_sprint", exc) from exc

    async def start_sprint(
        self,
        request: StartSprintRequest,
        ctx: RequestContext,
    ) -> StartSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.start(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return StartSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("start_sprint", exc) from exc

    async def complete_sprint(
        self,
        request: CompleteSprintRequest,
        ctx: RequestContext,
    ) -> CompleteSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.complete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return CompleteSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("complete_sprint", exc) from exc

    async def delete_sprint(
        self,
        request: DeleteSprintRequest,
        ctx: RequestContext,
    ) -> DeleteSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return DeleteSprintResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_sprint", exc) from exc

    async def list_sprints(
        self,
        request: ListSprintsRequest,
        ctx: RequestContext,
    ) -> ListSprintsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                include_closed = (
                    request.include_closed if request.has_field("include_closed") else False
                )
                sprints = await ops.list_sprints(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_closed=include_closed,
                )

                sprint_ids = [s.id for s in sprints]
                counts = await ops.get_task_counts(sprint_ids)

                sprint_protos = []
                for sprint in sprints:
                    total, completed = counts.get(str(sprint.id), (0, 0))
                    sprint_protos.append(sprint_to_proto(sprint, total, completed))

                return ListSprintsResponse(sprints=sprint_protos)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_sprints", exc) from exc


class WatcherHandlers:
    async def toggle_task_watcher(
        self,
        request: ToggleTaskWatcherRequest,
        ctx: RequestContext,
    ) -> ToggleTaskWatcherResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                ops = WatcherOperations(session)
                is_watching, _ = await ops.toggle(user_id, organization_id, task_id)

                return ToggleTaskWatcherResponse(is_watching=is_watching)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("toggle_task_watcher", exc) from exc

    async def list_task_watchers(
        self,
        request: ListTaskWatchersRequest,
        ctx: RequestContext,
    ) -> ListTaskWatchersResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskReader(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                ops = WatcherOperations(session)
                watcher_ids = await ops.get_watcher_user_ids(task_id)
                count = len(watcher_ids)

                return ListTaskWatchersResponse(
                    watcher_user_ids=[str(w) for w in watcher_ids],
                    watcher_count=count,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_task_watchers", exc) from exc

    async def bulk_check_task_watchers(
        self,
        request: BulkCheckTaskWatchersRequest,
        ctx: RequestContext,
    ) -> BulkCheckTaskWatchersResponse:
        user_id = current_user_id()
        parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = WatcherOperations(session)
                result = await ops.bulk_check(user_id, list(request.task_ids))
                return BulkCheckTaskWatchersResponse(watched_tasks=result)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("bulk_check_task_watchers", exc) from exc
