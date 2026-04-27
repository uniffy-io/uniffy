"""Built-in cron scheduling tools for agents."""

import json

from uniffy.core.types import AccessMode
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_cron_create(ctx: ToolContext, args: dict) -> ToolResult:
    """Create a new scheduled recurring task."""
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    name = args.get("name", "").strip()
    if not name:
        return ToolResult(success=False, data="", error="name is required")

    prompt = args.get("prompt", "").strip()
    if not prompt:
        return ToolResult(success=False, data="", error="prompt is required")

    cron_expression = args.get("cron_expression", "").strip()
    if not cron_expression:
        return ToolResult(success=False, data="", error="cron_expression is required")

    timezone = args.get("timezone", "UTC").strip()

    agent_id = getattr(ctx, "agent_id", None)
    if not agent_id:
        return ToolResult(success=False, data="", error="Agent context not available")

    ops = CronTaskOperations(ctx.session)
    task = await ops.create_cron_task(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        agent_id=agent_id,
        name=name,
        prompt=prompt,
        cron_expression=cron_expression,
        timezone=timezone,
        access_mode=AccessMode.OWNER_ONLY,
    )

    # Compute human-readable next run info
    next_run_str = task.next_run_at.strftime("%Y-%m-%d %H:%M %Z") if task.next_run_at else "unknown"

    return ToolResult(
        success=True,
        data=json.dumps({
            "id": str(task.id),
            "name": task.name,
            "cron_expression": task.cron_expression,
            "timezone": task.timezone,
            "next_run_at": next_run_str,
            "is_enabled": task.is_enabled,
        }),
    )


async def _execute_cron_list(ctx: ToolContext, args: dict) -> ToolResult:
    """List scheduled tasks accessible to the user."""
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    agent_id = getattr(ctx, "agent_id", None)

    ops = CronTaskOperations(ctx.session)
    tasks, total = await ops.list_cron_tasks(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        agent_id=agent_id,
        page=1,
        page_size=args.get("limit", 20),
    )

    if not tasks:
        return ToolResult(success=True, data="No scheduled tasks found.")

    lines = [f"Found {total} scheduled task(s):"]
    for t in tasks:
        status = "active" if t.is_enabled else "paused"
        if not t.is_enabled and t.consecutive_failures >= t.max_consecutive_failures:
            status = "auto-disabled (failures)"
        next_run = t.next_run_at.strftime("%Y-%m-%d %H:%M UTC") if t.next_run_at else "none"
        last_run = ""
        if t.last_run_at:
            status_text = t.last_run_status or "unknown"
            run_time = t.last_run_at.strftime("%Y-%m-%d %H:%M UTC")
            last_run = f", last run: {status_text} at {run_time}"
        lines.append(
            f"- [{status}] {t.name} (id: {t.id})\n"
            f"  Schedule: {t.cron_expression} ({t.timezone})\n"
            f"  Next run: {next_run}{last_run}\n"
            f"  Total runs: {t.run_count}"
        )

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_cron_update(ctx: ToolContext, args: dict) -> ToolResult:
    """Update a scheduled task."""
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    task_id_str = args.get("task_id", "").strip()
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    from uuid import UUID

    task_id = UUID(task_id_str)

    updates = {}
    if "name" in args:
        updates["name"] = args["name"]
    if "prompt" in args:
        updates["prompt"] = args["prompt"]
    if "cron_expression" in args:
        updates["cron_expression"] = args["cron_expression"]
    if "timezone" in args:
        updates["timezone"] = args["timezone"]
    if "is_enabled" in args:
        updates["is_enabled"] = args["is_enabled"]

    if not updates:
        return ToolResult(success=False, data="", error="No updates provided")

    ops = CronTaskOperations(ctx.session)
    task = await ops.update_cron_task(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        task_id=task_id,
        **updates,
    )

    next_run_str = task.next_run_at.strftime("%Y-%m-%d %H:%M %Z") if task.next_run_at else "none"
    status = "active" if task.is_enabled else "paused"

    return ToolResult(
        success=True,
        data=f'Task "{task.name}" updated. Status: {status}, next run: {next_run_str}',
    )


async def _execute_cron_delete(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a scheduled task."""
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    task_id_str = args.get("task_id", "").strip()
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    from uuid import UUID

    task_id = UUID(task_id_str)

    ops = CronTaskOperations(ctx.session)
    # get_by_id + _require_delete happen inside delete()
    await ops.delete(ctx.user_id, ctx.organization_id, task_id)

    return ToolResult(success=True, data="Scheduled task deleted.")


async def _execute_cron_get_runs(ctx: ToolContext, args: dict) -> ToolResult:
    """View execution history for a scheduled task."""
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    task_id_str = args.get("task_id", "").strip()
    if not task_id_str:
        return ToolResult(success=False, data="", error="task_id is required")

    from uuid import UUID

    task_id = UUID(task_id_str)
    limit = min(args.get("limit", 10), 20)

    ops = CronTaskOperations(ctx.session)
    logs, total = await ops.get_run_logs(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        task_id=task_id,
        page=1,
        page_size=limit,
    )

    if not logs:
        return ToolResult(success=True, data="No execution history found.")

    lines = [f"Showing {len(logs)} of {total} executions:"]
    for log in logs:
        started = log.started_at.strftime("%Y-%m-%d %H:%M UTC")
        tokens = f"{log.input_tokens} in / {log.output_tokens} out"
        summary = ""
        if log.result_summary:
            summary = f"\n  Summary: {log.result_summary[:200]}"
        error = ""
        if log.error:
            error = f"\n  Error: {log.error[:200]}"
        lines.append(f"- [{log.status}] {started} ({tokens}){summary}{error}")

    return ToolResult(success=True, data="\n".join(lines))


# -- Tool definitions --------------------------------------------------------

cron_create = ToolDefinition(
    name="cron.create",
    description=(
        "Create a recurring scheduled task. The task will execute on the "
        "specified schedule, sending the prompt to yourself (this agent) "
        "and delivering the result as a notification. "
        "Convert the user's natural language schedule to a 5-field cron "
        "expression (minute hour day-of-month month day-of-week). "
        "Examples: 'every Monday at 9am' = '0 9 * * 1', "
        "'daily at 6pm' = '0 18 * * *', "
        "'every hour' = '0 * * * *', "
        "'weekdays at 9am' = '0 9 * * 1-5', "
        "'first of every month at 10am' = '0 10 1 * *'. "
        "Default timezone to UTC unless the user specifies one."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Short, descriptive name for this task.",
            },
            "prompt": {
                "type": "string",
                "description": (
                    "The instruction message sent to you on each execution. "
                    "Write this as if the user is asking you directly."
                ),
            },
            "cron_expression": {
                "type": "string",
                "description": (
                    "5-field cron expression: minute hour day-of-month month day-of-week."
                ),
            },
            "timezone": {
                "type": "string",
                "description": "IANA timezone (e.g. 'America/New_York'). Default: 'UTC'.",
            },
        },
        "required": ["name", "prompt", "cron_expression"],
    },
    executor=_execute_cron_create,
)

cron_list = ToolDefinition(
    name="cron.list",
    description=(
        "List all scheduled tasks. Shows name, schedule, status, "
        "next run time, and execution history summary."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Maximum number of tasks to return (default 20).",
            },
        },
    },
    executor=_execute_cron_list,
    read_only=True,
)

cron_update = ToolDefinition(
    name="cron.update",
    description=(
        "Update a scheduled task's name, prompt, schedule, timezone, "
        "or enabled status. Use this to pause/resume, change the schedule, "
        "or modify what the task does."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "ID of the scheduled task to update.",
            },
            "name": {
                "type": "string",
                "description": "New task name.",
            },
            "prompt": {
                "type": "string",
                "description": "New prompt to send on each execution.",
            },
            "cron_expression": {
                "type": "string",
                "description": "New cron expression.",
            },
            "timezone": {
                "type": "string",
                "description": "New IANA timezone.",
            },
            "is_enabled": {
                "type": "boolean",
                "description": "Set to false to pause, true to resume.",
            },
        },
        "required": ["task_id"],
    },
    executor=_execute_cron_update,
)

cron_delete = ToolDefinition(
    name="cron.delete",
    description="Delete a scheduled task permanently.",
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "ID of the scheduled task to delete.",
            },
        },
        "required": ["task_id"],
    },
    executor=_execute_cron_delete,
    destructive=True,
)

cron_get_runs = ToolDefinition(
    name="cron.get_runs",
    description=(
        "View the execution history of a scheduled task. "
        "Shows status, timestamps, token usage, and result summaries."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "ID of the scheduled task.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of runs to show (default 10, max 20).",
            },
        },
        "required": ["task_id"],
    },
    executor=_execute_cron_get_runs,
    read_only=True,
)

CRON_TOOLS: list[ToolDefinition] = [
    cron_create,
    cron_list,
    cron_update,
    cron_delete,
    cron_get_runs,
]
