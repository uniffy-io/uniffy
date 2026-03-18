"""Built-in project and task tools for agents."""

import contextlib
from uuid import UUID

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

# Valid enums for validation hints in tool descriptions
VALID_VISIBILITY_SCOPES = ["PRIVATE", "GROUP", "ORGANIZATION"]


async def _execute_create_project(ctx: ToolContext, args: dict) -> ToolResult:
    """Create a new project."""
    from uniffy.core.models.shared import VisibilityScope
    from uniffy.domains.projects.operations import ProjectOperations

    name = args.get("name", "")
    if not name:
        return ToolResult(success=False, data="", error="name is required")

    kwargs: dict = {}
    if "description" in args:
        kwargs["description"] = args["description"]
    if "icon" in args:
        kwargs["icon"] = args["icon"]
    if "color" in args:
        kwargs["color"] = args["color"]
    if "slug" in args:
        kwargs["slug"] = args["slug"]
    if "visibility" in args:
        try:
            kwargs["visibility"] = VisibilityScope(args["visibility"])
        except ValueError:
            return ToolResult(
                success=False,
                data="",
                error=(
                    f"Invalid visibility: {args['visibility']}. "
                    f"Must be one of: {VALID_VISIBILITY_SCOPES}"
                ),
            )

    ops = ProjectOperations(ctx.session)
    project = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        name=name,
        **kwargs,
    )

    urn = f"urn:uniffy:content:PROJECT:{project.id}"
    return ToolResult(
        success=True,
        data=f"Project created successfully: [[[{project.name}|{urn}]]]",
    )


async def _execute_update_project(ctx: ToolContext, args: dict) -> ToolResult:
    """Update a project's details."""
    from uniffy.core.models.shared import VisibilityScope
    from uniffy.domains.projects.operations import ProjectOperations

    project_id_str = args.get("project_id", "")
    if not project_id_str:
        return ToolResult(success=False, data="", error="project_id is required")

    try:
        project_id = UUID(project_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid project_id: {project_id_str}")

    kwargs: dict = {}
    for field in ("name", "description", "icon", "color", "slug"):
        if field in args:
            kwargs[field] = args[field]
    if "visibility" in args:
        try:
            kwargs["visibility"] = VisibilityScope(args["visibility"])
        except ValueError:
            return ToolResult(
                success=False,
                data="",
                error=(
                    f"Invalid visibility: {args['visibility']}. "
                    f"Must be one of: {VALID_VISIBILITY_SCOPES}"
                ),
            )

    if not kwargs:
        return ToolResult(success=False, data="", error="At least one field to update is required")

    ops = ProjectOperations(ctx.session)
    project = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        project_id=project_id,
        **kwargs,
    )

    urn = f"urn:uniffy:content:PROJECT:{project.id}"
    return ToolResult(
        success=True,
        data=f"Project updated successfully: [[[{project.name}|{urn}]]]",
    )


async def _execute_delete_project(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a project."""
    from uniffy.domains.projects.operations import ProjectOperations

    project_id_str = args.get("project_id", "")
    if not project_id_str:
        return ToolResult(success=False, data="", error="project_id is required")

    try:
        project_id = UUID(project_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid project_id: {project_id_str}")

    ops = ProjectOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        project_id=project_id,
    )

    return ToolResult(success=True, data="Project deleted successfully.")


async def _execute_list_projects(ctx: ToolContext, args: dict) -> ToolResult:
    """List projects in the organization."""
    from uniffy.domains.projects.operations import ProjectOperations

    ops = ProjectOperations(ctx.session)
    projects, total = await ops.list_projects(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
    )

    if not projects:
        return ToolResult(success=True, data="No projects found.")

    lines = [f"Found {total} projects:"]
    for p in projects:
        desc = f" - {p.description[:80]}..." if p.description else ""
        urn = f"urn:uniffy:content:PROJECT:{p.id}"
        lines.append(f"- [[[{p.name}|{urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


def _parse_uuid(value: str, field_name: str) -> tuple[UUID | None, str | None]:
    """Parse a UUID string, returning (uuid, None) or (None, error_message)."""
    try:
        return UUID(value), None
    except ValueError:
        return None, f"Invalid {field_name}: {value}"


def _parse_uuid_list(values: list, field_name: str) -> tuple[list[str] | None, str | None]:
    """Parse a list of UUID strings, returning (id_list, None) or (None, error_message)."""
    if not values:
        return None, None
    parsed = []
    for v in values:
        try:
            UUID(v)  # validate
            parsed.append(v)
        except ValueError:
            return None, f"Invalid UUID in {field_name}: {v}"
    return parsed, None


def _apply_task_type(
    args: dict,
    kwargs: dict,
) -> tuple[dict, str | None]:
    """Validate and apply task_type if present."""
    if "task_type" not in args:
        return kwargs, None
    task_type = args["task_type"]
    valid = ("task", "bug", "feature", "story", "epic")
    if task_type not in valid:
        return kwargs, (f"Invalid task_type: {task_type}. Must be one of: {', '.join(valid)}")
    kwargs["task_type"] = task_type
    return kwargs, None


def _apply_assignee_ids(
    args: dict,
    kwargs: dict,
    *,
    allow_clear: bool = False,
) -> tuple[dict, str | None]:
    """Parse assignee_ids or assignee_id from args."""
    if "assignee_ids" in args:
        assignee_ids = args["assignee_ids"]
        if isinstance(assignee_ids, str):
            assignee_ids = [assignee_ids]
        if not assignee_ids:
            if allow_clear:
                kwargs["assignee_ids"] = None
            return kwargs, None
        parsed, err = _parse_uuid_list(assignee_ids, "assignee_ids")
        if err:
            return kwargs, err
        kwargs["assignee_ids"] = parsed
    elif "assignee_id" in args:
        aid = args["assignee_id"]
        if not aid and allow_clear:
            kwargs["assignee_ids"] = None
        elif aid:
            with contextlib.suppress(ValueError):
                kwargs["assignee_ids"] = [aid]
    return kwargs, None


def _apply_blocked_by(
    args: dict,
    kwargs: dict,
    *,
    allow_clear: bool = False,
) -> tuple[dict, str | None]:
    """Parse blocked_by_task_ids from args."""
    if "blocked_by_task_ids" not in args:
        return kwargs, None
    blocked_ids = args["blocked_by_task_ids"]
    if isinstance(blocked_ids, str):
        blocked_ids = [blocked_ids]
    if not blocked_ids:
        if allow_clear:
            kwargs["blocked_by_task_ids"] = None
        return kwargs, None
    parsed, err = _parse_uuid_list(blocked_ids, "blocked_by_task_ids")
    if err:
        return kwargs, err
    kwargs["blocked_by_task_ids"] = parsed
    return kwargs, None


def _format_task_result(prefix: str, task) -> str:
    """Format a task result string with metadata."""
    urn = f"urn:uniffy:content:TASK:{task.id}"
    parts = [f"{prefix}: [[[{task.title}|{urn}]]]"]
    parts.append(f"Type: {task.task_type} | Status: {task.status} | Priority: {task.priority}")
    if task.assignee_ids:
        parts.append(f"Assignees: {', '.join(task.assignee_ids)}")
    if task.parent_id:
        parts.append(f"Subtask of: {task.parent_id}")
    if task.blocked_by_task_ids:
        ids = ", ".join(task.blocked_by_task_ids)
        parts.append(f"Blocked by: {ids}")
    if task.sprint_id:
        parts.append(f"Sprint: {task.sprint_id}")
    return "\n".join(parts)


async def _execute_create_task(ctx: ToolContext, args: dict) -> ToolResult:
    """Create a new task in a project."""
    from uniffy.domains.projects.operations import TaskOperations

    project_id_str = args.get("project_id", "")
    if not project_id_str:
        return ToolResult(success=False, data="", error="project_id is required")

    project_id, err = _parse_uuid(project_id_str, "project_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    title = args.get("title", "")
    if not title:
        return ToolResult(success=False, data="", error="title is required")

    kwargs: dict = {}

    _TASK_STRING_FIELDS = (
        "description",
        "status",
        "priority",
        "due_date",
        "start_date",
        "recurrence_rule",
    )
    for field in _TASK_STRING_FIELDS:
        if field in args:
            kwargs[field] = args[field]

    # Task type
    kwargs, err = _apply_task_type(args, kwargs)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Boolean fields
    if "is_milestone" in args:
        kwargs["is_milestone"] = bool(args["is_milestone"])

    # Assignee IDs (list of UUIDs)
    kwargs, err = _apply_assignee_ids(args, kwargs)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Parent task (subtask)
    if "parent_id" in args:
        parent_id, err = _parse_uuid(args["parent_id"], "parent_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["parent_id"] = parent_id

    # Blocked by (task dependencies)
    kwargs, err = _apply_blocked_by(args, kwargs)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Sprint assignment
    if "sprint_id" in args:
        sprint_id, err = _parse_uuid(args["sprint_id"], "sprint_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        kwargs["sprint_id"] = sprint_id

    ops = TaskOperations(ctx.session)
    task = await ops.create(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        project_id=project_id,
        title=title,
        task_type=args.get("task_type", "task"),
        **kwargs,
    )

    return ToolResult(
        success=True,
        data=_format_task_result("Task created", task),
    )


async def _execute_update_task(ctx: ToolContext, args: dict) -> ToolResult:
    """Update a task."""
    from uniffy.domains.projects.operations import TaskOperations

    task_id_str = args.get("task_id", "")
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    task_id, err = _parse_uuid(task_id_str, "task_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    kwargs: dict = {}

    # Simple string fields
    _UPDATE_STRING_FIELDS = (
        "title",
        "description",
        "status",
        "priority",
        "due_date",
        "start_date",
        "recurrence_rule",
    )
    for field in _UPDATE_STRING_FIELDS:
        if field in args:
            kwargs[field] = args[field]

    # Task type
    kwargs, err = _apply_task_type(args, kwargs)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Boolean fields
    if "is_milestone" in args:
        kwargs["is_milestone"] = bool(args["is_milestone"])

    # Assignee IDs
    kwargs, err = _apply_assignee_ids(args, kwargs, allow_clear=True)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Parent task - can be cleared
    if "parent_id" in args:
        if not args["parent_id"]:
            kwargs["parent_id"] = None
        else:
            parent_id, err = _parse_uuid(
                args["parent_id"],
                "parent_id",
            )
            if err:
                return ToolResult(success=False, data="", error=err)
            kwargs["parent_id"] = parent_id

    # Blocked by - can be cleared
    kwargs, err = _apply_blocked_by(args, kwargs, allow_clear=True)
    if err:
        return ToolResult(success=False, data="", error=err)

    # Sprint - can be cleared to move to backlog
    if "sprint_id" in args:
        if not args["sprint_id"]:
            kwargs["sprint_id"] = None
        else:
            sprint_id, err = _parse_uuid(
                args["sprint_id"],
                "sprint_id",
            )
            if err:
                return ToolResult(success=False, data="", error=err)
            kwargs["sprint_id"] = sprint_id

    if not kwargs:
        return ToolResult(
            success=False,
            data="",
            error="At least one field to update is required",
        )

    ops = TaskOperations(ctx.session)
    task = await ops.update(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        task_id=task_id,
        **kwargs,
    )

    return ToolResult(
        success=True,
        data=_format_task_result("Task updated", task),
    )


async def _execute_delete_task(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a task."""
    from uniffy.domains.projects.operations import TaskOperations

    task_id_str = args.get("task_id", "")
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    try:
        task_id = UUID(task_id_str)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid task_id: {task_id_str}")

    ops = TaskOperations(ctx.session)
    await ops.delete(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        task_id=task_id,
    )

    return ToolResult(success=True, data="Task deleted successfully.")


async def _execute_list_tasks(ctx: ToolContext, args: dict) -> ToolResult:
    """List tasks in a project with optional filters."""
    from uniffy.domains.projects.operations import TaskOperations

    project_id_str = args.get("project_id", "")
    if not project_id_str:
        return ToolResult(success=False, data="", error="project_id is required")

    project_id, err = _parse_uuid(project_id_str, "project_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    # Build filter kwargs
    list_kwargs: dict = {}

    if "parent_id" in args:
        pid = args["parent_id"]
        if pid == "root":
            list_kwargs["parent_id"] = "root"
        elif pid:
            parent_id, err = _parse_uuid(pid, "parent_id")
            if err:
                return ToolResult(success=False, data="", error=err)
            list_kwargs["parent_id"] = parent_id

    if "sprint_id" in args:
        sprint_id, err = _parse_uuid(args["sprint_id"], "sprint_id")
        if err:
            return ToolResult(success=False, data="", error=err)
        list_kwargs["sprint_id"] = sprint_id

    if args.get("backlog_only"):
        list_kwargs["backlog_only"] = True

    ops = TaskOperations(ctx.session)
    tasks, total = await ops.list_tasks(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        project_id=project_id,
        **list_kwargs,
    )

    if not tasks:
        return ToolResult(success=True, data="No tasks found matching the filters.")

    lines = [f"Found {total} tasks:"]
    for t in tasks:
        urn = f"urn:uniffy:content:TASK:{t.id}"
        meta_parts = [f"{t.status}", f"priority:{t.priority}", f"type:{t.task_type}"]
        if t.assignee_ids:
            meta_parts.append(f"assignees:{','.join(t.assignee_ids)}")
        if t.due_date:
            meta_parts.append(f"due:{t.due_date}")
        if t.start_date:
            meta_parts.append(f"start:{t.start_date}")
        if t.parent_id:
            meta_parts.append(f"parent:{t.parent_id}")
        if t.blocked_by_task_ids:
            meta_parts.append(f"blocked_by:{','.join(t.blocked_by_task_ids)}")
        if t.is_milestone:
            meta_parts.append("milestone")
        if t.sprint_id:
            meta_parts.append(f"sprint:{t.sprint_id}")
        meta = " | ".join(meta_parts)
        lines.append(f"- [[[{t.title}|{urn}]]] ({meta})")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_move_task(ctx: ToolContext, args: dict) -> ToolResult:
    """Move a task to a different status."""
    from uniffy.domains.projects.operations import TaskOperations

    task_id_str = args.get("task_id", "")
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    task_id, err = _parse_uuid(task_id_str, "task_id")
    if err:
        return ToolResult(success=False, data="", error=err)

    status = args.get("status", "")
    if not status:
        return ToolResult(success=False, data="", error="status is required")

    # sort_order defaults to appending at the end of the target column
    sort_order = args.get("sort_order", 0)

    ops = TaskOperations(ctx.session)
    task = await ops.move(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        task_id=task_id,
        status=status,
        sort_order=sort_order,
    )

    urn = f"urn:uniffy:content:TASK:{task.id}"
    return ToolResult(
        success=True,
        data=f"Task moved successfully: [[[{task.title}|{urn}]]] -> {task.status}",
    )


# -- Tool definitions --------------------------------------------------------

create_project = ToolDefinition(
    name="projects.create_project",
    description="Create a new project in the organization.",
    parameter_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Project name."},
            "description": {"type": "string", "description": "Project description."},
            "icon": {
                "type": "string",
                "description": "Icon identifier (e.g. 'folder', 'rocket', 'bug').",
            },
            "color": {"type": "string", "description": "Hex color code (e.g. '#3b82f6')."},
            "visibility": {
                "type": "string",
                "enum": ["PRIVATE", "GROUP", "ORGANIZATION"],
                "description": ("PRIVATE (owner only), GROUP (shared), ORGANIZATION (all members)."),
            },
            "slug": {
                "type": "string",
                "description": (
                    "Uppercase slug (2-5 chars, e.g. 'PROJ'). Auto-generated if omitted."
                ),
            },
        },
        "required": ["name"],
    },
    executor=_execute_create_project,
)

update_project = ToolDefinition(
    name="projects.update_project",
    description=("Update a project's name, description, icon, color, or visibility."),
    parameter_schema={
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "UUID of the project."},
            "name": {"type": "string", "description": "New project name."},
            "description": {"type": "string", "description": "New project description."},
            "icon": {"type": "string", "description": "New icon identifier."},
            "color": {"type": "string", "description": "New hex color code."},
            "visibility": {
                "type": "string",
                "enum": ["PRIVATE", "GROUP", "ORGANIZATION"],
                "description": "New access scope.",
            },
            "slug": {"type": "string", "description": "New project slug (2-5 uppercase chars)."},
        },
        "required": ["project_id"],
    },
    executor=_execute_update_project,
)

delete_project = ToolDefinition(
    name="projects.delete_project",
    description="Delete a project. This is destructive and removes all associated tasks.",
    parameter_schema={
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "UUID of the project to delete."},
        },
        "required": ["project_id"],
    },
    executor=_execute_delete_project,
    destructive=True,
)

list_projects = ToolDefinition(
    name="projects.list_projects",
    description="List all projects in the organization.",
    parameter_schema={"type": "object", "properties": {}},
    executor=_execute_list_projects,
)

create_task = ToolDefinition(
    name="tasks.create_task",
    description=(
        "Create a task with subtasks, dependencies, multiple assignees, sprints, and task types."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "UUID of the project."},
            "title": {"type": "string", "description": "Task title."},
            "description": {
                "type": "string",
                "description": "Markdown description. Supports [[[label|urn]]] mentions.",
            },
            "status": {
                "type": "string",
                "description": (
                    "e.g. 'status_todo', 'status_in_progress', "
                    "'status_in_review', 'status_done'. "
                    "Default: status_todo."
                ),
            },
            "priority": {
                "type": "string",
                "description": (
                    "e.g. 'priority_none', 'priority_low', "
                    "'priority_medium', 'priority_high', "
                    "'priority_urgent'. Default: priority_medium."
                ),
            },
            "task_type": {
                "type": "string",
                "enum": ["task", "bug", "feature", "story", "epic"],
                "description": "Issue type. Defaults to 'task'.",
            },
            "assignee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of user UUIDs to assign to the task.",
            },
            "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format."},
            "start_date": {"type": "string", "description": "Start date in YYYY-MM-DD format."},
            "parent_id": {
                "type": "string",
                "description": "UUID of parent task to create this as a subtask.",
            },
            "blocked_by_task_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of task UUIDs that block this task (dependencies).",
            },
            "sprint_id": {
                "type": "string",
                "description": "UUID of the sprint to assign to. Omit for backlog.",
            },
            "is_milestone": {
                "type": "boolean",
                "description": "Mark as a milestone for roadmap view.",
            },
        },
        "required": ["project_id", "title"],
    },
    executor=_execute_create_task,
)

update_task = ToolDefinition(
    name="tasks.update_task",
    description=(
        "Update any task field: status, priority, type, assignees, dates, subtask parent, "
        "dependencies (blocked_by), sprint assignment, milestone flag, and more. "
        "Pass empty values to clear optional fields."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "UUID of the task."},
            "title": {"type": "string", "description": "New task title."},
            "description": {"type": "string", "description": "New markdown description."},
            "status": {
                "type": "string",
                "description": (
                    "e.g. 'status_todo', 'status_in_progress', 'status_in_review', 'status_done'."
                ),
            },
            "priority": {
                "type": "string",
                "description": (
                    "e.g. 'priority_none', 'priority_low', "
                    "'priority_medium', 'priority_high', "
                    "'priority_urgent'."
                ),
            },
            "task_type": {
                "type": "string",
                "enum": ["task", "bug", "feature", "story", "epic"],
                "description": "Change the issue type.",
            },
            "assignee_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of user UUIDs. Empty array to unassign all.",
            },
            "due_date": {
                "type": "string",
                "description": "New due date (YYYY-MM-DD). Empty string to clear.",
            },
            "start_date": {
                "type": "string",
                "description": "New start date (YYYY-MM-DD). Empty string to clear.",
            },
            "parent_id": {
                "type": "string",
                "description": "UUID of new parent task. Empty string to make top-level.",
            },
            "blocked_by_task_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "New list of blocking task UUIDs. Empty array to clear dependencies.",
            },
            "sprint_id": {
                "type": "string",
                "description": "UUID of sprint. Empty string to move to backlog.",
            },
            "is_milestone": {"type": "boolean", "description": "Set or unset milestone flag."},
        },
        "required": ["task_id"],
    },
    executor=_execute_update_task,
)

delete_task = ToolDefinition(
    name="tasks.delete_task",
    description="Delete a task. This is destructive.",
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "UUID of the task to delete."},
        },
        "required": ["task_id"],
    },
    executor=_execute_delete_task,
    destructive=True,
)

list_tasks = ToolDefinition(
    name="tasks.list_tasks",
    description=(
        "List tasks in a project with full details (status, priority, type, assignees, dates, "
        "dependencies, subtask hierarchy, sprint). Supports filtering by parent, sprint, or backlog."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "UUID of the project."},
            "parent_id": {
                "type": "string",
                "description": (
                    "Filter by parent: 'root' for top-level only, "
                    "or a task UUID for subtasks. Omit for all."
                ),
            },
            "sprint_id": {
                "type": "string",
                "description": "Filter by sprint UUID.",
            },
            "backlog_only": {
                "type": "boolean",
                "description": "If true, only show unassigned sprint tasks.",
            },
        },
        "required": ["project_id"],
    },
    executor=_execute_list_tasks,
)

move_task = ToolDefinition(
    name="tasks.move_task",
    description=(
        "Move a task to a different status column "
        "(e.g. status_todo, status_in_progress, status_done)."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "UUID of the task."},
            "status": {
                "type": "string",
                "description": (
                    "Target status ID (e.g. 'status_todo', 'status_in_progress', 'status_done')."
                ),
            },
        },
        "required": ["task_id", "status"],
    },
    executor=_execute_move_task,
)

PROJECT_TOOLS: list[ToolDefinition] = [
    create_project,
    update_project,
    delete_project,
    list_projects,
]

TASK_TOOLS: list[ToolDefinition] = [
    create_task,
    update_task,
    delete_task,
    list_tasks,
    move_task,
]
