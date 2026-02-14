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
from sqlalchemy.orm.attributes import flag_modified

from uniffy.core.converters.common_proto import visibility_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.projects import queries
from uniffy.domains.projects.converters import (
    activity_to_proto,
    field_to_proto,
    field_type_from_proto,
    project_to_proto,
    task_to_proto,
    view_to_proto,
    view_type_from_proto,
)
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations
from uniffy.gen.common.v1.common_pb2 import PaginationResponse
from uniffy.gen.projects.v1.projects_pb2 import (
    ActivityResponse,
    AddCommentRequest,
    BulkUpdateTasksRequest,
    BulkUpdateTasksResponse,
    CreateFieldRequest,
    CreateProjectRequest,
    CreateTaskRequest,
    CreateViewRequest,
    DeleteCommentRequest,
    DeleteCommentResponse,
    DeleteFieldRequest,
    DeleteFieldResponse,
    DeleteProjectRequest,
    DeleteProjectResponse,
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
    ListTasksRequest,
    ListTasksResponse,
    MoveTaskRequest,
    ProjectResponse,
    TaskResponse,
    UpdateCommentRequest,
    UpdateFieldRequest,
    UpdateProjectRequest,
    UpdateTaskRequest,
    UpdateViewRequest,
    ViewResponse,
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

                project = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.HasField("description") else "",
                    icon=request.icon if request.HasField("icon") else "folder",
                    color=request.color if request.HasField("color") else "#3b82f6",
                    visibility=visibility,
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

                project = await ops.update(user_id, organization_id, project_id, **updates)

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
                    **kwargs,
                )

                return TaskResponse(task=task_to_proto(task))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Project not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
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

                return TaskResponse(task=task_to_proto(task))

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

                return TaskResponse(task=task_to_proto(task))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
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

                return TaskResponse(task=task_to_proto(task))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
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

                tasks, total = await ops.list_tasks(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_deleted=request.include_deleted
                    if request.HasField("include_deleted")
                    else False,
                    parent_id=parent_id,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListTasksResponse(
                    tasks=[task_to_proto(t) for t in tasks],
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
                can_admin = await project_ops.permission_checker.can_admin_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_admin:
                    raise PermissionDeniedError("create", "field", "Requires ADMIN permission")

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

                can_admin = await project_ops.permission_checker.can_admin_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_admin:
                    raise PermissionDeniedError("update", "field", "Requires ADMIN permission")

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

                can_admin = await project_ops.permission_checker.can_admin_content(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=project_ops.content_type,
                    content_id=project.id,
                    content_owner_id=project.owner_id,
                    content_visibility=project.visibility,
                )
                if not can_admin:
                    raise PermissionDeniedError("delete", "field", "Requires ADMIN permission")

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
                    raise ValidationError("Cannot delete system field")

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

    async def add_comment(
        self,
        request: AddCommentRequest,
        ctx: RequestContext,
    ) -> ActivityResponse:
        """Add a comment to a task."""
        try:
            organization_id = UUID(request.organization_id)
            task_id = UUID(request.task_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify task access (requires EDIT permission on project)
                task_ops = TaskOperations(session)
                task = await task_ops.get_by_id(user_id, organization_id, task_id)
                await task_ops._require_edit(user_id, organization_id, task)

                # Create comment activity
                activity = await task_ops._log_activity(
                    task_id=task_id,
                    actor_id=user_id,
                    action="comment",
                    content=request.content,
                )
                await session.commit()
                await session.refresh(activity)

                return ActivityResponse(activity=activity_to_proto(activity))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Task not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error adding comment")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_comment(
        self,
        request: UpdateCommentRequest,
        ctx: RequestContext,
    ) -> ActivityResponse:
        """Update a comment."""
        try:
            activity_id = UUID(request.activity_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Fetch activity

                result = await session.execute(
                    select(TaskActivity).where(TaskActivity.id == activity_id)
                )
                activity = result.scalar_one_or_none()
                if not activity:
                    raise NotFoundError("Activity", activity_id)

                # Only author can update comment
                if activity.actor_id != user_id:
                    raise PermissionDeniedError(
                        "update", "comment", "Only author can update comment"
                    )

                activity.content = request.content
                await session.commit()
                await session.refresh(activity)

                return ActivityResponse(activity=activity_to_proto(activity))

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error updating comment")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_comment(
        self,
        request: DeleteCommentRequest,
        ctx: RequestContext,
    ) -> DeleteCommentResponse:
        """Delete a comment."""
        try:
            activity_id = UUID(request.activity_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Fetch activity

                result = await session.execute(
                    select(TaskActivity).where(TaskActivity.id == activity_id)
                )
                activity = result.scalar_one_or_none()
                if not activity:
                    raise NotFoundError("Activity", activity_id)

                # Only author can delete comment
                if activity.actor_id != user_id:
                    raise PermissionDeniedError(
                        "delete", "comment", "Only author can delete comment"
                    )

                await session.delete(activity)
                await session.commit()

                return DeleteCommentResponse(success=True)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception:
            logger.opt(exception=True).error("Error deleting comment")
            raise ConnectError(Code.INTERNAL, "Internal server error")
