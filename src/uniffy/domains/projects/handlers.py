"""Projects RPC handlers - thin layer delegating to operations."""

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

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import visibility_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.types import ContentType as DomainContentType
from uniffy.db import get_async_session
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


class ProjectsHandlers:
    """Projects RPC handlers."""

    # =========================================================================
    # Project handlers
    # =========================================================================

    async def create_project(
        self,
        request: CreateProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Create a new project."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = ProjectOperations(session)

                # Parse optional visibility
                visibility = None
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                slug = request.slug if request.HasField("slug") else None

                project = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.HasField("description") else "",
                    icon=request.icon if request.HasField("icon") else "folder",
                    color=request.color if request.HasField("color") else "#3b82f6",
                    visibility=visibility,
                    slug=slug,
                )

                # Fetch fields and views for response
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)

                return ProjectResponse(project=project_to_proto(project, fields, views))

        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error creating project")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_project(
        self,
        request: GetProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Get a project by ID."""
        try:
            project_id = UUID(request.project_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = ProjectOperations(session)
                project = await ops.get_by_id(user_id, organization_id, project_id)

                # Compute user's permission level
                checker = PermissionChecker(session)
                perm_level = await checker.get_user_permission_level(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=DomainContentType.PROJECT,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                )

                # Fetch fields and views
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)

                return ProjectResponse(project=project_to_proto(project, fields, views, perm_level))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error getting project")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_project(
        self,
        request: UpdateProjectRequest,
        ctx: RequestContext,
    ) -> ProjectResponse:
        """Update an existing project."""
        try:
            project_id = UUID(request.project_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = ProjectOperations(session)

                # Build update kwargs
                updates = {}
                if request.HasField("name"):
                    updates["name"] = request.name
                if request.HasField("description"):
                    updates["description"] = request.description
                if request.HasField("icon"):
                    updates["icon"] = request.icon
                if request.HasField("color"):
                    updates["color"] = request.color
                if request.HasField("visibility"):
                    updates["visibility"] = visibility_from_proto(request.visibility)
                if request.member_ids:
                    updates["member_ids"] = list(request.member_ids)
                if request.HasField("default_view_id"):
                    updates["default_view_id"] = request.default_view_id
                if request.HasField("slug"):
                    updates["slug"] = request.slug

                try:
                    project = await ops.update(user_id, organization_id, project_id, **updates)
                except IntegrityError:
                    raise ConnectError(
                        Code.ALREADY_EXISTS,
                        "A project with that slug already exists",
                    )

                # Fetch fields and views
                fields = await queries.get_fields_for_project(session, project.id)
                views = await queries.get_views_for_project(session, project.id)

                return ProjectResponse(project=project_to_proto(project, fields, views))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating project")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_project(
        self,
        request: DeleteProjectRequest,
        ctx: RequestContext,
    ) -> DeleteProjectResponse:
        """Delete a project."""
        try:
            project_id = UUID(request.project_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = ProjectOperations(session)
                await ops.delete(user_id, organization_id, project_id, permanent=request.permanent)

                return DeleteProjectResponse(
                    success=True,
                    message="Project deleted successfully",
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting project")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_projects(
        self,
        request: ListProjectsRequest,
        ctx: RequestContext,
    ) -> ListProjectsResponse:
        """List projects."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = ProjectOperations(session)

                # Parse pagination
                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = min(
                        request.pagination.page_size if request.pagination.page_size > 0 else 50,
                        100,
                    )

                # Parse visibility filter
                visibility = None
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                projects, total = await ops.list_projects(
                    user_id=user_id,
                    organization_id=organization_id,
                    visibility=visibility,
                    include_deleted=request.include_deleted
                    if request.HasField("include_deleted")
                    else False,
                    page=page,
                    page_size=page_size,
                )

                # Batch-load fields and views for all projects
                project_ids = [p.id for p in projects]
                fields_map = await queries.get_fields_for_projects(session, project_ids)
                views_map = await queries.get_views_for_projects(session, project_ids)

                project_protos = []
                for project in projects:
                    fields = fields_map.get(str(project.id), [])
                    views = views_map.get(str(project.id), [])
                    project_protos.append(project_to_proto(project, fields, views))

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
        except Exception:
            logger.opt(exception=True).error("Error listing projects")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # =========================================================================
    # Task handlers
    # =========================================================================

    async def create_task(
        self,
        request: CreateTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Create a new task."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)

                # Build kwargs for optional fields
                kwargs = {
                    "description": request.description if request.HasField("description") else "",
                    "status": request.status if request.HasField("status") else "status_todo",
                    "priority": request.priority
                    if request.HasField("priority")
                    else "priority_medium",
                    "task_type": request.task_type if request.HasField("task_type") else "task",
                }

                if request.assignee_ids:
                    kwargs["assignee_ids"] = list(request.assignee_ids)
                if request.HasField("start_date"):
                    kwargs["start_date"] = request.start_date
                if request.HasField("due_date"):
                    kwargs["due_date"] = request.due_date
                if request.HasField("parent_id"):
                    try:
                        kwargs["parent_id"] = UUID(request.parent_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")
                if request.blocked_by_task_ids:
                    kwargs["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
                if request.HasField("is_milestone"):
                    kwargs["is_milestone"] = request.is_milestone
                if request.HasField("recurrence_rule"):
                    kwargs["recurrence_rule"] = request.recurrence_rule
                if request.HasField("sprint_id"):
                    try:
                        kwargs["sprint_id"] = UUID(request.sprint_id) if request.sprint_id else None
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid sprint_id")
                if request.HasField("estimated_minutes"):
                    kwargs["estimated_minutes"] = request.estimated_minutes or None
                if request.HasField("time_spent_minutes"):
                    kwargs["time_spent_minutes"] = request.time_spent_minutes or None
                if request.field_values:
                    # Convert proto map to dict, decoding JSON strings
                    field_values = {}
                    for key, value in request.field_values.items():
                        # Try to decode as JSON, fallback to string
                        try:
                            field_values[key] = json.loads(value)
                        except json.JSONDecodeError, ValueError:
                            field_values[key] = value
                    kwargs["field_values"] = field_values

                task = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    title=request.title,
                    task_type=kwargs.pop("task_type", "task"),
                    **kwargs,
                )

                # If subtask, load parent with updated counts
                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent, subtask_total=p_total, subtask_completed=p_done
                    )

                return TaskResponse(
                    task=task_to_proto(task),
                    updated_parent=updated_parent_proto,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error creating task")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_task(
        self,
        request: GetTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Get a task by ID."""
        try:
            task_id = UUID(request.task_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)
                task = await ops.get_by_id(user_id, organization_id, task_id)

                # Compute user's permission level on the parent project
                checker = PermissionChecker(session)
                perm_level = await checker.get_user_permission_level(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=DomainContentType.PROJECT,
                    content_id=task.project_id,
                    content_owner_id=task.owner_id,
                )

                # Load subtask counts
                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))

                return TaskResponse(
                    task=task_to_proto(task, perm_level, st_total, st_done)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error getting task")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_task(
        self,
        request: UpdateTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Update an existing task."""
        try:
            task_id = UUID(request.task_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)

                # Build update kwargs
                updates = {}
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
                    try:
                        updates["parent_id"] = UUID(request.parent_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")
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
                    try:
                        updates["sprint_id"] = UUID(request.sprint_id) if request.sprint_id else None
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid sprint_id")
                if request.HasField("estimated_minutes"):
                    updates["estimated_minutes"] = request.estimated_minutes or None
                if request.HasField("time_spent_minutes"):
                    updates["time_spent_minutes"] = request.time_spent_minutes or None
                if request.field_values:
                    # Convert proto map to dict, decoding JSON strings
                    field_values = {}
                    for key, value in request.field_values.items():
                        try:
                            field_values[key] = json.loads(value)
                        except json.JSONDecodeError, ValueError:
                            field_values[key] = value
                    updates["field_values"] = field_values

                task = await ops.update(user_id, organization_id, task_id, **updates)

                # Load subtask counts for the updated task itself
                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))

                # If this is a subtask, load updated parent with fresh counts
                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent, subtask_total=p_total, subtask_completed=p_done
                    )

                return TaskResponse(
                    task=task_to_proto(
                        task, subtask_total=st_total, subtask_completed=st_done
                    ),
                    updated_parent=updated_parent_proto,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating task")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def move_task(
        self,
        request: MoveTaskRequest,
        ctx: RequestContext,
    ) -> TaskResponse:
        """Move a task (board drag-and-drop)."""
        try:
            task_id = UUID(request.task_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)
                task = await ops.move(
                    user_id,
                    organization_id,
                    task_id,
                    request.status,
                    request.sort_order,
                )

                # Load subtask counts for the moved task
                subtask_counts = await queries.get_subtask_counts(session, [task.id])
                st_total, st_done = subtask_counts.get(task.id, (0, 0))

                # If subtask, load parent with fresh counts
                updated_parent_proto = None
                if task.parent_id:
                    parent = await ops.get_by_id(user_id, organization_id, task.parent_id)
                    parent_counts = await queries.get_subtask_counts(session, [parent.id])
                    p_total, p_done = parent_counts.get(parent.id, (0, 0))
                    updated_parent_proto = task_to_proto(
                        parent, subtask_total=p_total, subtask_completed=p_done
                    )

                return TaskResponse(
                    task=task_to_proto(
                        task, subtask_total=st_total, subtask_completed=st_done
                    ),
                    updated_parent=updated_parent_proto,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error moving task")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_update_tasks(
        self,
        request: BulkUpdateTasksRequest,
        ctx: RequestContext,
    ) -> BulkUpdateTasksResponse:
        """Update multiple tasks at once."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)

                # Build changes dict
                changes = {}
                if request.HasField("status"):
                    changes["status"] = request.status
                if request.HasField("priority"):
                    changes["priority"] = request.priority
                if request.assignee_ids:
                    changes["assignee_ids"] = list(request.assignee_ids)
                if request.HasField("sprint_id"):
                    try:
                        changes["sprint_id"] = (
                            UUID(request.sprint_id) if request.sprint_id else None
                        )
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid sprint_id")

                tasks = await ops.bulk_update(
                    user_id,
                    organization_id,
                    list(request.task_ids),
                    **changes,
                )

                return BulkUpdateTasksResponse(
                    tasks=[task_to_proto(t) for t in tasks],
                    updated_count=len(tasks),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error bulk updating tasks")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_task(
        self,
        request: DeleteTaskRequest,
        ctx: RequestContext,
    ) -> DeleteTaskResponse:
        """Delete a task."""
        try:
            task_id = UUID(request.task_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)
                await ops.delete(user_id, organization_id, task_id, permanent=request.permanent)

                return DeleteTaskResponse(
                    success=True,
                    message="Task deleted successfully",
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting task")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_tasks(
        self,
        request: DeleteTasksRequest,
        ctx: RequestContext,
    ) -> DeleteTasksResponse:
        """Delete multiple tasks."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)

                count = 0
                for task_id_str in request.task_ids:
                    try:
                        task_id = UUID(task_id_str)
                        await ops.delete(
                            user_id, organization_id, task_id, permanent=request.permanent
                        )
                        count += 1
                    except NotFoundError, PermissionDeniedError:
                        # Skip tasks that can't be deleted
                        continue

                return DeleteTasksResponse(
                    success=True,
                    deleted_count=count,
                )

        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting tasks")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_tasks(
        self,
        request: ListTasksRequest,
        ctx: RequestContext,
    ) -> ListTasksResponse:
        """List tasks for a project."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = TaskOperations(session)

                # Parse pagination
                page = 1
                page_size = 500
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = min(
                        request.pagination.page_size if request.pagination.page_size > 0 else 500,
                        1000,
                    )

                # Parse parent_id
                parent_id = None
                if request.HasField("parent_id"):
                    if request.parent_id == "root":
                        parent_id = "root"
                    elif request.parent_id:
                        try:
                            parent_id = UUID(request.parent_id)
                        except ValueError:
                            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

                # Parse sprint filter
                sprint_id_filter = None
                if request.HasField("sprint_id"):
                    try:
                        sprint_id_filter = UUID(request.sprint_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid sprint_id")

                backlog_only = request.backlog_only if request.HasField("backlog_only") else False

                tasks, total = await ops.list_tasks(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_deleted=request.include_deleted
                    if request.HasField("include_deleted")
                    else False,
                    parent_id=parent_id,
                    sprint_id=sprint_id_filter,
                    backlog_only=backlog_only,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                # Batch-load subtask counts for all tasks
                task_ids = [t.id for t in tasks]
                subtask_counts = await queries.get_subtask_counts(session, task_ids)

                task_protos = []
                for t in tasks:
                    st_total, st_done = subtask_counts.get(t.id, (0, 0))
                    task_protos.append(
                        task_to_proto(t, subtask_total=st_total, subtask_completed=st_done)
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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error listing tasks")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # =========================================================================
    # Field handlers
    # =========================================================================

    async def create_field(
        self,
        request: CreateFieldRequest,
        ctx: RequestContext,
    ) -> FieldResponse:
        """Create a field definition."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access (requires ADMIN permission)
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)

                # Check for ADMIN permission
                can_edit = await project_ops.permission_checker.can_edit_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_edit:
                    raise PermissionDeniedError("create", "field", "Requires EDIT permission")

                # Parse config if provided
                config = {}
                if request.HasField("config_json"):
                    try:
                        config = json.loads(request.config_json)
                    except json.JSONDecodeError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json")

                # Generate field ID

                field_id = f"field_{secrets.token_hex(8)}"

                field = FieldDefinition(
                    id=field_id,
                    project_id=project_id,
                    name=request.name,
                    type=field_type_from_proto(request.type),
                    is_required=request.is_required if request.HasField("is_required") else False,
                    is_system=False,
                    sort_order=request.sort_order if request.HasField("sort_order") else 999,
                    config=config if config else None,
                )
                session.add(field)
                await session.commit()
                await session.refresh(field)

                return FieldResponse(field=field_to_proto(field))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error creating field")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_field(
        self,
        request: UpdateFieldRequest,
        ctx: RequestContext,
    ) -> FieldResponse:
        """Update a field definition."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)

                can_edit = await project_ops.permission_checker.can_edit_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_edit:
                    raise PermissionDeniedError("update", "field", "Requires EDIT permission")

                # Fetch field

                result = await session.execute(
                    select(FieldDefinition).where(
                        FieldDefinition.id == request.field_id,
                        FieldDefinition.project_id == project_id,
                    )
                )
                field = result.scalar_one_or_none()
                if not field:
                    raise NotFoundError("Field", request.field_id)

                # Apply updates
                if request.HasField("name"):
                    field.name = request.name
                if request.HasField("is_required"):
                    field.is_required = request.is_required
                if request.HasField("sort_order"):
                    field.sort_order = request.sort_order
                if request.HasField("config_json"):
                    try:
                        field.config = json.loads(request.config_json)
                    except json.JSONDecodeError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json")

                # Explicitly flag modified for JSON fields to ensure change detection
                if request.HasField("config_json"):
                    flag_modified(field, "config")

                field.updated_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(field)

                return FieldResponse(field=field_to_proto(field))

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating field")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_field(
        self,
        request: DeleteFieldRequest,
        ctx: RequestContext,
    ) -> DeleteFieldResponse:
        """Delete a field definition."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)

                can_edit = await project_ops.permission_checker.can_edit_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_edit:
                    raise PermissionDeniedError("delete", "field", "Requires EDIT permission")

                # Fetch field

                result = await session.execute(
                    select(FieldDefinition).where(
                        FieldDefinition.id == request.field_id,
                        FieldDefinition.project_id == project_id,
                    )
                )
                field = result.scalar_one_or_none()
                if not field:
                    raise NotFoundError("Field", request.field_id)

                # Cannot delete system fields
                if field.is_system:
                    raise ValidationError("field", "Cannot delete system field")

                await session.delete(field)
                await session.commit()

                return DeleteFieldResponse(success=True)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting field")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # =========================================================================
    # View handlers
    # =========================================================================

    async def create_view(
        self,
        request: CreateViewRequest,
        ctx: RequestContext,
    ) -> ViewResponse:
        """Create a view configuration."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access (requires EDIT permission)
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_edit(user_id, organization_id, project)

                # Parse config
                config = {}
                if request.HasField("config_json"):
                    try:
                        config = json.loads(request.config_json)
                    except json.JSONDecodeError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json")

                # Generate view ID

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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error creating view")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_view(
        self,
        request: UpdateViewRequest,
        ctx: RequestContext,
    ) -> ViewResponse:
        """Update a view configuration."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_edit(user_id, organization_id, project)

                # Fetch view

                result = await session.execute(
                    select(ViewConfig).where(
                        ViewConfig.id == request.view_id,
                        ViewConfig.project_id == project_id,
                    )
                )
                view = result.scalar_one_or_none()
                if not view:
                    raise NotFoundError("View", request.view_id)

                # Apply updates
                if request.HasField("name"):
                    view.name = request.name
                if request.HasField("is_default"):
                    view.is_default = request.is_default
                if request.HasField("config_json"):
                    try:
                        view.config = json.loads(request.config_json)
                    except json.JSONDecodeError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json")

                view.updated_at = datetime.now(UTC)
                await session.commit()
                await session.refresh(view)

                return ViewResponse(view=view_to_proto(view))

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating view")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_view(
        self,
        request: DeleteViewRequest,
        ctx: RequestContext,
    ) -> DeleteViewResponse:
        """Delete a view configuration."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify project access
                project_ops = ProjectOperations(session)
                project = await project_ops.get_by_id(user_id, organization_id, project_id)
                await project_ops._require_edit(user_id, organization_id, project)

                # Fetch view

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

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting view")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # =========================================================================
    # Activity handlers
    # =========================================================================

    async def list_activities(
        self,
        request: ListActivitiesRequest,
        ctx: RequestContext,
    ) -> ListActivitiesResponse:
        """List activities for a task."""
        try:
            organization_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify task access (requires VIEW permission on project)
                task_ops = TaskOperations(session)
                await task_ops.get_by_id(user_id, organization_id, task_id)

                # Parse pagination
                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    if request.pagination.page_size > 0:
                        page_size = min(request.pagination.page_size, 200)
                    else:
                        page_size = 50

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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error listing activities")
            raise ConnectError(Code.INTERNAL, "Internal server error")


class SprintHandlers:
    """Sprint RPC handlers."""

    async def create_sprint(
        self,
        request: CreateSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Create a new sprint."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error creating sprint")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_sprint(
        self,
        request: UpdateSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Update a sprint."""
        try:
            organization_id = UUID(request.organization_id)
            sprint_id = UUID(request.sprint_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Sprint not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating sprint")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def start_sprint(
        self,
        request: StartSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Start a sprint (make it active)."""
        try:
            organization_id = UUID(request.organization_id)
            sprint_id = UUID(request.sprint_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = SprintOperations(session)
                sprint = await ops.start(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    start_date=request.start_date if request.HasField("start_date") else None,
                    end_date=request.end_date if request.HasField("end_date") else None,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Sprint not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error starting sprint")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def complete_sprint(
        self,
        request: CompleteSprintRequest,
        ctx: RequestContext,
    ) -> SprintResponse:
        """Complete a sprint."""
        try:
            organization_id = UUID(request.organization_id)
            sprint_id = UUID(request.sprint_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = SprintOperations(session)
                sprint = await ops.complete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return SprintResponse(sprint=sprint_to_proto(sprint))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Sprint not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error completing sprint")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_sprint(
        self,
        request: DeleteSprintRequest,
        ctx: RequestContext,
    ) -> DeleteSprintResponse:
        """Delete a sprint and move its tasks to backlog."""
        try:
            organization_id = UUID(request.organization_id)
            sprint_id = UUID(request.sprint_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = SprintOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return DeleteSprintResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Sprint not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting sprint")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_sprints(
        self,
        request: ListSprintsRequest,
        ctx: RequestContext,
    ) -> ListSprintsResponse:
        """List sprints for a project."""
        try:
            organization_id = UUID(request.organization_id)
            project_id = UUID(request.project_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
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

                # Batch-load task counts
                sprint_ids = [s.id for s in sprints]
                counts = await ops.get_task_counts(sprint_ids)

                sprint_protos = []
                for sprint in sprints:
                    total, completed = counts.get(str(sprint.id), (0, 0))
                    sprint_protos.append(sprint_to_proto(sprint, total, completed))

                return ListSprintsResponse(sprints=sprint_protos)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error listing sprints")
            raise ConnectError(Code.INTERNAL, "Internal server error")


class WatcherHandlers:
    """Task watcher RPC handlers."""

    async def toggle_task_watcher(
        self,
        request: ToggleTaskWatcherRequest,
        ctx: RequestContext,
    ) -> ToggleTaskWatcherResponse:
        """Toggle watch state for a task."""
        try:
            organization_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify task access
                task_ops = TaskOperations(session)
                await task_ops.get_by_id(
                    user_id, organization_id, task_id
                )

                ops = WatcherOperations(session)
                is_watching, _ = await ops.toggle(
                    user_id, organization_id, task_id
                )

                return ToggleTaskWatcherResponse(
                    is_watching=is_watching
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(
                Code.PERMISSION_DENIED, "Access denied"
            )
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error(
                "Error toggling task watcher"
            )
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_task_watchers(
        self,
        request: ListTaskWatchersRequest,
        ctx: RequestContext,
    ) -> ListTaskWatchersResponse:
        """List watchers for a task."""
        try:
            organization_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify task access
                task_ops = TaskOperations(session)
                await task_ops.get_by_id(
                    user_id, organization_id, task_id
                )

                ops = WatcherOperations(session)
                watcher_ids = await ops.get_watcher_user_ids(task_id)
                count = len(watcher_ids)

                return ListTaskWatchersResponse(
                    watcher_user_ids=[str(w) for w in watcher_ids],
                    watcher_count=count,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(
                Code.PERMISSION_DENIED, "Access denied"
            )
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error(
                "Error listing task watchers"
            )
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_check_task_watchers(
        self,
        request: BulkCheckTaskWatchersRequest,
        ctx: RequestContext,
    ) -> BulkCheckTaskWatchersResponse:
        """Check watch status for multiple tasks."""
        try:
            UUID(request.organization_id)
        except ValueError:
            raise ConnectError(
                Code.INVALID_ARGUMENT, "Invalid organization_id"
            )

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = WatcherOperations(session)
                result = await ops.bulk_check(
                    user_id, list(request.task_ids)
                )

                return BulkCheckTaskWatchersResponse(
                    watched_tasks=result
                )

        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error(
                "Error bulk checking task watchers"
            )
            raise ConnectError(Code.INTERNAL, "Internal server error")
