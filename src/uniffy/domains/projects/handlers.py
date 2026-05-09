"""Projects RPC handlers."""

import json
import secrets
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from uniffy_proto.common.v1.common_pb2 import PaginationResponse
from uniffy_proto.projects.v1.projects_pb2 import (
    BulkCheckTaskWatchersRequest,
    BulkCheckTaskWatchersResponse,
    BulkUpdateTasksRequest,
    BulkUpdateTasksResponse,
    CompleteSprintRequest,
    CreateFieldRequest,
    CreateProjectRequest,
    CreateSprintRequest,
    CreateTaskRequest,
    CreateViewRequest,
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
    DeleteViewRequest,
    DeleteViewResponse,
    FieldResponse,
    GetProjectRequest,
    GetTaskRequest,
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
    ProjectResponse,
    SprintResponse,
    StartSprintRequest,
    TaskResponse,
    ToggleTaskWatcherRequest,
    ToggleTaskWatcherResponse,
    UpdateFieldRequest,
    UpdateProjectRequest,
    UpdateSprintRequest,
    UpdateTaskRequest,
    UpdateViewRequest,
    ViewResponse,
)

from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.tags.tag import Tag
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.projects import queries
from uniffy.domains.projects.converters import (
    activity_to_proto,
    field_to_proto,
    field_type_from_proto,
    project_to_proto,
    sprint_to_proto,
    task_to_proto,
    view_to_proto,
    view_type_from_proto,
)
from uniffy.domains.projects.operations import (
    ProjectOperations,
    SprintOperations,
    TaskOperations,
    WatcherOperations,
)
from uniffy.domains.tags import TagOperations


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _parse_tag_ids(raw_ids) -> list[UUID]:
    """Parse a repeated string proto field into a list of UUIDs."""
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
    """Bulk-fetch unified-tag rows for a batch of task ids."""
    if not task_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.TASK, tid): tid for tid in task_ids}
    tag_ops = TagOperations(session)
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
    """Bulk-fetch unified-tag rows for a batch of project ids."""
    if not project_ids:
        return {}
    urn_to_id = {build_content_urn(ContentType.PROJECT, pid): pid for pid in project_ids}
    tag_ops = TagOperations(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {pid: bulk.get(urn, []) for urn, pid in urn_to_id.items()}


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.FAILED_PRECONDITION, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.error(f"Error in {operation}: {exc}", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class ProjectsHandlers:
    """RPC handlers for ``projects.v1.ProjectsService``."""

    async def create_project(
        self,
        request: CreateProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Create a new project."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )
        slug = request.slug if request.HasField("slug") else None

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session)
                project = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.HasField("description") else "",
                    icon=request.icon if request.HasField("icon") else "folder",
                    color=request.color if request.HasField("color") else "#3b82f6",
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    slug=slug,
                    tag_ids=tag_ids or None,
                )
                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                return ProjectResponse(
                    project=project_to_proto(
                        project, fields, views, user_role, tags=tags_by_id.get(project.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_project", exc) from exc

    async def get_project(
        self,
        request: GetProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Get a project by ID."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session)
                project = await ops.get_by_id(user_id, organization_id, project_id)
                user_role = await ops._resolve_role(user_id, organization_id, project)

                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])

                return ProjectResponse(
                    project=project_to_proto(
                        project, fields, views, user_role, tags=tags_by_id.get(project.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_project", exc) from exc

    async def update_project(
        self,
        request: UpdateProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Update an existing project."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        updates: dict = {}
        if request.HasField("name"):
            updates["name"] = request.name
        if request.HasField("description"):
            updates["description"] = request.description
        if request.HasField("icon"):
            updates["icon"] = request.icon
        if request.HasField("color"):
            updates["color"] = request.color
        if request.HasField("default_view_id"):
            updates["default_view_id"] = request.default_view_id
        if request.HasField("slug"):
            updates["slug"] = request.slug
        if request.type_field_schemas:
            updates["type_field_schemas"] = {
                type_name: {
                    "shown_field_ids": list(schema.shown_field_ids),
                    "required_field_ids": list(schema.required_field_ids),
                }
                for type_name, schema in request.type_field_schemas.items()
            }
        if request.HasField("tag_ids"):
            updates["tag_ids"] = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = ProjectOperations(session)
                try:
                    project = await ops.update(user_id, organization_id, project_id, **updates)
                except IntegrityError as exc:
                    raise ConnectError(
                        Code.ALREADY_EXISTS,
                        "A project with that slug already exists",
                    ) from exc

                user_role = await ops._resolve_role(user_id, organization_id, project)
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)
                tags_by_id = await _hydrate_project_tags(session, organization_id, [project.id])
                return ProjectResponse(
                    project=project_to_proto(
                        project, fields, views, user_role, tags=tags_by_id.get(project.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_project", exc) from exc

    async def delete_project(
        self,
        request: DeleteProjectRequest,
        ctx: RequestContext,
    ) -> DeleteProjectResponse:
        """Delete a project."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = ProjectOperations(session)
                await ops.delete(user_id, organization_id, project_id, permanent=request.permanent)
                return DeleteProjectResponse(success=True, message="Project deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_project", exc) from exc

    async def list_projects(
        self,
        request: ListProjectsRequest,
        ctx: RequestContext,
    ) -> ListProjectsResponse:
        """List projects the user can access."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None

        try:
            async with open_session() as session:
                ops = ProjectOperations(session)
                projects, total = await ops.list_projects(
                    user_id=user_id,
                    organization_id=organization_id,
                    access_mode=access_mode,
                    include_deleted=(
                        request.include_deleted if request.HasField("include_deleted") else False
                    ),
                    page=page,
                    page_size=page_size,
                )

                project_ids = [p.id for p in projects]
                fields_map = await queries.get_fields_for_projects(session, project_ids)
                views_map = await queries.get_views_for_projects(session, project_ids)
                tags_by_id = await _hydrate_project_tags(session, organization_id, project_ids)

                project_protos = []
                for project in projects:
                    user_role = await ops._resolve_role(user_id, organization_id, project)
                    fields = fields_map.get(str(project.id), [])
                    views = views_map.get(str(project.id), [])
                    project_protos.append(
                        project_to_proto(
                            project, fields, views, user_role, tags=tags_by_id.get(project.id)
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
            raise _map_domain_error("list_projects", exc) from exc

    async def create_task(
        self,
        request: CreateTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Create a new task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        kwargs: dict = {
            "description": request.description if request.HasField("description") else "",
            "status": request.status if request.HasField("status") else "status_todo",
            "priority": (request.priority if request.HasField("priority") else "priority_medium"),
            "task_type": request.task_type if request.HasField("task_type") else "task",
        }

        if request.assignee_ids:
            kwargs["assignee_ids"] = list(request.assignee_ids)
        if request.HasField("start_date"):
            kwargs["start_date"] = request.start_date
        if request.HasField("due_date"):
            kwargs["due_date"] = request.due_date
        if request.HasField("parent_id"):
            kwargs["parent_id"] = _parse_uuid(request.parent_id, "parent_id")
        if request.blocked_by_task_ids:
            kwargs["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
        if request.HasField("is_milestone"):
            kwargs["is_milestone"] = request.is_milestone
        if request.HasField("recurrence_rule"):
            kwargs["recurrence_rule"] = request.recurrence_rule
        if request.HasField("sprint_id"):
            kwargs["sprint_id"] = (
                _parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )
        if request.HasField("estimated_minutes"):
            kwargs["estimated_minutes"] = request.estimated_minutes or None
        if request.HasField("time_spent_minutes"):
            kwargs["time_spent_minutes"] = request.time_spent_minutes or None
        if request.field_values:
            field_values: dict = {}
            for key, value in request.field_values.items():
                try:
                    field_values[key] = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    field_values[key] = value
            kwargs["field_values"] = field_values

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
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

                return TaskResponse(
                    task=task_to_proto(task, user_role, tags=tags_by_id.get(task.id)),
                    updated_parent=updated_parent_proto,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_task", exc) from exc

    async def get_task(
        self,
        request: GetTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Get a task by ID."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
                task = await ops.get_by_id(user_id, organization_id, task_id)
                user_role = await ops._resolve_role(user_id, organization_id, task)

                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))
                tags_by_id = await _hydrate_task_tags(session, organization_id, [task.id])

                return TaskResponse(
                    task=task_to_proto(
                        task, user_role, st_total, st_done, tags=tags_by_id.get(task.id)
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_task", exc) from exc

    async def update_task(
        self,
        request: UpdateTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Update an existing task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        updates: dict = {}
        if request.HasField("title"):
            updates["title"] = request.title
        if request.HasField("description"):
            updates["description"] = request.description
        if request.HasField("status"):
            updates["status"] = request.status
        if request.HasField("priority"):
            updates["priority"] = request.priority
        if request.assignee_ids:
            updates["assignee_ids"] = list(request.assignee_ids)
        if request.HasField("start_date"):
            updates["start_date"] = request.start_date or None
        if request.HasField("due_date"):
            updates["due_date"] = request.due_date or None
        if request.HasField("parent_id"):
            updates["parent_id"] = _parse_uuid(request.parent_id, "parent_id")
        if request.blocked_by_task_ids:
            updates["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
        if request.HasField("is_milestone"):
            updates["is_milestone"] = request.is_milestone
        if request.HasField("recurrence_rule"):
            updates["recurrence_rule"] = request.recurrence_rule
        if request.HasField("sort_order"):
            updates["sort_order"] = request.sort_order
        if request.HasField("task_type"):
            updates["task_type"] = request.task_type
        if request.HasField("sprint_id"):
            updates["sprint_id"] = (
                _parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )
        if request.HasField("estimated_minutes"):
            updates["estimated_minutes"] = request.estimated_minutes or None
        if request.HasField("time_spent_minutes"):
            updates["time_spent_minutes"] = request.time_spent_minutes or None
        if request.field_values:
            field_values: dict = {}
            for key, value in request.field_values.items():
                try:
                    field_values[key] = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    field_values[key] = value
            updates["field_values"] = field_values
        if request.HasField("tag_ids"):
            updates["tag_ids"] = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
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

                return TaskResponse(
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
            raise _map_domain_error("update_task", exc) from exc

    async def move_task(
        self,
        request: MoveTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Move a task (board drag-and-drop)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
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

                return TaskResponse(
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
            raise _map_domain_error("move_task", exc) from exc

    async def bulk_update_tasks(
        self,
        request: BulkUpdateTasksRequest,
        ctx: RequestContext,
    ) -> BulkUpdateTasksResponse:
        """Update multiple tasks in one call."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        changes: dict = {}
        if request.HasField("status"):
            changes["status"] = request.status
        if request.HasField("priority"):
            changes["priority"] = request.priority
        if request.assignee_ids:
            changes["assignee_ids"] = list(request.assignee_ids)
        if request.HasField("sprint_id"):
            changes["sprint_id"] = (
                _parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
            )

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
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
            raise _map_domain_error("bulk_update_tasks", exc) from exc

    async def delete_task(
        self,
        request: DeleteTaskRequest,
        ctx: RequestContext,
    ) -> DeleteTaskResponse:
        """Delete a task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
                await ops.delete(user_id, organization_id, task_id, permanent=request.permanent)
                return DeleteTaskResponse(success=True, message="Task deleted successfully")
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_task", exc) from exc

    async def delete_tasks(
        self,
        request: DeleteTasksRequest,
        ctx: RequestContext,
    ) -> DeleteTasksResponse:
        """Delete multiple tasks (skipping any that fail)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
                count = 0
                for task_id_str in request.task_ids:
                    try:
                        task_id = UUID(task_id_str)
                        await ops.delete(
                            user_id, organization_id, task_id, permanent=request.permanent
                        )
                        count += 1
                    except (NotFoundError, PermissionDeniedError, ValueError):
                        continue
                return DeleteTasksResponse(success=True, deleted_count=count)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_tasks", exc) from exc

    async def list_tasks(
        self,
        request: ListTasksRequest,
        ctx: RequestContext,
    ) -> ListTasksResponse:
        """List tasks for a project."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        page = 1
        page_size = 500
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 500,
                1000,
            )

        parent_id: UUID | str | None = None
        if request.HasField("parent_id"):
            if request.parent_id == "root":
                parent_id = "root"
            elif request.parent_id:
                parent_id = _parse_uuid(request.parent_id, "parent_id")

        sprint_id_filter = None
        if request.HasField("sprint_id"):
            sprint_id_filter = _parse_uuid(request.sprint_id, "sprint_id")

        backlog_only = request.backlog_only if request.HasField("backlog_only") else False
        tag_ids_filter = _parse_tag_ids(list(request.tag_ids))

        from uniffy_proto.projects.v1.projects_pb2 import TagFilterMode as _TagFilterMode

        if request.HasField("tag_filter_mode"):
            mode_value = request.tag_filter_mode
        else:
            mode_value = _TagFilterMode.TAG_FILTER_MODE_ALL
        tag_filter_mode = {
            _TagFilterMode.TAG_FILTER_MODE_ALL: "all",
            _TagFilterMode.TAG_FILTER_MODE_ANY: "any",
            _TagFilterMode.TAG_FILTER_MODE_NONE: "none",
        }.get(mode_value, "all")

        try:
            async with open_session() as session:
                ops = TaskOperations(session)
                tasks, total = await ops.list_tasks(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_deleted=(
                        request.include_deleted if request.HasField("include_deleted") else False
                    ),
                    parent_id=parent_id,
                    sprint_id=sprint_id_filter,
                    backlog_only=backlog_only,
                    tag_ids=tag_ids_filter or None,
                    tag_filter_mode=tag_filter_mode,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                project_ops = ProjectOperations(session)
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
            raise _map_domain_error("list_tasks", exc) from exc

    async def create_field(
        self,
        request: CreateFieldRequest,
        ctx: RequestContext,
    ) -> FieldResponse:
        """Create a custom field definition."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        config: dict = {}
        if request.HasField("config_json"):
            try:
                config = json.loads(request.config_json)
            except json.JSONDecodeError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                field_id = f"field_{secrets.token_hex(8)}"
                field = FieldDefinition(
                    id=field_id,
                    project_id=project_id,
                    name=request.name,
                    type=field_type_from_proto(request.type),
                    is_required=(request.is_required if request.HasField("is_required") else False),
                    is_system=False,
                    sort_order=request.sort_order if request.HasField("sort_order") else 999,
                    config=config if config else None,
                )
                session.add(field)
                await session.commit()
                await session.refresh(field)

                return FieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_field", exc) from exc

    async def update_field(
        self,
        request: UpdateFieldRequest,
        ctx: RequestContext,
    ) -> FieldResponse:
        """Update a custom field definition."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
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

                if request.HasField("name"):
                    field.name = request.name
                if request.HasField("is_required"):
                    field.is_required = request.is_required
                if request.HasField("sort_order"):
                    field.sort_order = request.sort_order
                if request.HasField("config_json"):
                    try:
                        field.config = json.loads(request.config_json)
                    except json.JSONDecodeError as exc:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc
                    flag_modified(field, "config")

                field.updated_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(field)

                return FieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_field", exc) from exc

    async def delete_field(
        self,
        request: DeleteFieldRequest,
        ctx: RequestContext,
    ) -> DeleteFieldResponse:
        """Delete a custom field definition."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
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
            raise _map_domain_error("delete_field", exc) from exc

    async def create_view(
        self,
        request: CreateViewRequest,
        ctx: RequestContext,
    ) -> ViewResponse:
        """Create a view configuration."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        config: dict = {}
        if request.HasField("config_json"):
            try:
                config = json.loads(request.config_json)
            except json.JSONDecodeError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                view_id = f"view_{secrets.token_hex(8)}"
                view = ViewConfig(
                    id=view_id,
                    project_id=project_id,
                    name=request.name,
                    type=view_type_from_proto(request.type),
                    is_default=request.is_default if request.HasField("is_default") else False,
                    config=config if config else None,
                )
                session.add(view)
                await session.commit()
                await session.refresh(view)

                return ViewResponse(view=view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_view", exc) from exc

    async def update_view(
        self,
        request: UpdateViewRequest,
        ctx: RequestContext,
    ) -> ViewResponse:
        """Update a view configuration."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                result = await session.execute(
                    select(ViewConfig).where(
                        ViewConfig.id == request.view_id,
                        ViewConfig.project_id == project_id,
                    )
                )
                view = result.scalar_one_or_none()
                if not view:
                    raise NotFoundError("View", request.view_id)

                if request.HasField("name"):
                    view.name = request.name
                if request.HasField("is_default"):
                    view.is_default = request.is_default
                if request.HasField("config_json"):
                    try:
                        view.config = json.loads(request.config_json)
                    except json.JSONDecodeError as exc:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc

                view.updated_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(view)

                return ViewResponse(view=view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_view", exc) from exc

    async def delete_view(
        self,
        request: DeleteViewRequest,
        ctx: RequestContext,
    ) -> DeleteViewResponse:
        """Delete a view configuration."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_manage(user_id, organization_id, project)

                result = await session.execute(
                    select(ViewConfig).where(
                        ViewConfig.id == request.view_id,
                        ViewConfig.project_id == project_id,
                    )
                )
                view = result.scalar_one_or_none()
                if not view:
                    raise NotFoundError("View", request.view_id)

                await session.delete(view)
                await session.commit()

                return DeleteViewResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_view", exc) from exc

    async def list_activities(
        self,
        request: ListActivitiesRequest,
        ctx: RequestContext,
    ) -> ListActivitiesResponse:
        """List activities for a task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            if request.pagination.page_size > 0:
                page_size = min(request.pagination.page_size, 200)
            else:
                page_size = 50

        try:
            async with open_session() as session:
                task_ops = TaskOperations(session)
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
            raise _map_domain_error("list_activities", exc) from exc


class SprintHandlers:
    """Sprint RPC handlers."""

    async def create_sprint(
        self,
        request: CreateSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Create a new sprint."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    name=request.name,
                    goal=request.goal if request.HasField("goal") else "",
                    start_date=request.start_date if request.HasField("start_date") else None,
                    end_date=request.end_date if request.HasField("end_date") else None,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_sprint", exc) from exc

    async def update_sprint(
        self,
        request: UpdateSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Update a sprint."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        sprint_id = _parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    name=request.name if request.HasField("name") else None,
                    goal=request.goal if request.HasField("goal") else None,
                    start_date=request.start_date if request.HasField("start_date") else None,
                    end_date=request.end_date if request.HasField("end_date") else None,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_sprint", exc) from exc

    async def start_sprint(
        self,
        request: StartSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Start a sprint (make it active)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        sprint_id = _parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.start(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    start_date=request.start_date if request.HasField("start_date") else None,
                    end_date=request.end_date if request.HasField("end_date") else None,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("start_sprint", exc) from exc

    async def complete_sprint(
        self,
        request: CompleteSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Complete a sprint."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        sprint_id = _parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.complete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("complete_sprint", exc) from exc

    async def delete_sprint(
        self,
        request: DeleteSprintRequest,
        ctx: RequestContext,
    ) -> DeleteSprintResponse:
        """Delete a sprint (tasks move back to backlog)."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        sprint_id = _parse_uuid(request.sprint_id, "sprint_id")

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
            raise _map_domain_error("delete_sprint", exc) from exc

    async def list_sprints(
        self,
        request: ListSprintsRequest,
        ctx: RequestContext,
    ) -> ListSprintsResponse:
        """List sprints for a project."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        project_id = _parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                include_closed = (
                    request.include_closed if request.HasField("include_closed") else False
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
            raise _map_domain_error("list_sprints", exc) from exc


class WatcherHandlers:
    """Task watcher RPC handlers."""

    async def toggle_task_watcher(
        self,
        request: ToggleTaskWatcherRequest,
        ctx: RequestContext,
    ) -> ToggleTaskWatcherResponse:
        """Toggle watch state for a task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskOperations(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                ops = WatcherOperations(session)
                is_watching, _ = await ops.toggle(user_id, organization_id, task_id)

                return ToggleTaskWatcherResponse(is_watching=is_watching)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("toggle_task_watcher", exc) from exc

    async def list_task_watchers(
        self,
        request: ListTaskWatchersRequest,
        ctx: RequestContext,
    ) -> ListTaskWatchersResponse:
        """List watchers for a task."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        task_id = _parse_uuid(request.task_id, "task_id")

        try:
            async with open_session() as session:
                task_ops = TaskOperations(session)
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
            raise _map_domain_error("list_task_watchers", exc) from exc

    async def bulk_check_task_watchers(
        self,
        request: BulkCheckTaskWatchersRequest,
        ctx: RequestContext,
    ) -> BulkCheckTaskWatchersResponse:
        """Check watch status for multiple tasks."""
        user_id = get_user_id_from_context(ctx)
        _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = WatcherOperations(session)
                result = await ops.bulk_check(user_id, list(request.task_ids))
                return BulkCheckTaskWatchersResponse(watched_tasks=result)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("bulk_check_task_watchers", exc) from exc
