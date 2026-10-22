"""Built-in time tracking tools for agents."""

from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.projects.time.durations import format_minutes, parse_duration

_DURATION_DOC = "How long, as 1.5h, 1h 30m, 45m or a bare number of minutes."


def _today_for(ctx: ToolContext) -> date:
    zone = UTC
    if ctx.user_timezone:
        try:
            zone = ZoneInfo(ctx.user_timezone)
        except KeyError, ValueError:
            zone = UTC
    return datetime.now(zone).date()


def _parse_day(value: str | None, ctx: ToolContext) -> tuple[date | None, str | None]:
    if not value:
        return _today_for(ctx), None
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, f"Invalid date: {value} (expected YYYY-MM-DD)"


async def _execute_log_time(ctx: ToolContext, args: dict) -> ToolResult:
    """Log the acting user's own time on a task; agents never log for someone else."""
    from uniffy.core.models.projects.worklog import WorklogSource
    from uniffy.domains.projects.operations import TaskReader
    from uniffy.domains.projects.time.worklogs import WorklogOperations

    raw_task_id = args.get("task_id", "")
    try:
        task_id = UUID(raw_task_id)
    except ValueError:
        return ToolResult(success=False, data="", error=f"Invalid task_id: {raw_task_id}")

    minutes = parse_duration(str(args.get("duration", "")))
    if minutes is None or minutes <= 0:
        return ToolResult(
            success=False,
            data="",
            error="duration must be a positive time like 1.5h, 1h 30m or 45m",
        )

    day, err = _parse_day(args.get("date"), ctx)
    if err or day is None:
        return ToolResult(success=False, data="", error=err or "Invalid date")

    task = await TaskReader(ctx.session).get_by_id(ctx.user_id, ctx.organization_id, task_id)
    _, task_total = await WorklogOperations(ctx.session).create(
        ctx.user_id,
        ctx.organization_id,
        task.id,
        work_date=day,
        duration_minutes=minutes,
        description=str(args.get("description", "") or ""),
        source=WorklogSource.AGENT,
    )
    urn = f"urn:uniffy:content:TASK:{task.id}"
    return ToolResult(
        success=True,
        data=(
            f"Logged {format_minutes(minutes)} on [[[{task.title}|{urn}]]] "
            f"for {day.isoformat()}. Task total: {format_minutes(task_total)}."
        ),
    )


log_time = ToolDefinition(
    name="tasks.log_time",
    display_name="Log Time",
    group="Tasks",
    description=(
        "Log time the current user spent on a task. The entry belongs to the user you act "
        "for; it cannot log time for anyone else."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "UUID of the task."},
            "duration": {"type": "string", "description": _DURATION_DOC},
            "date": {
                "type": "string",
                "description": "Work day as YYYY-MM-DD. Defaults to today in the user's timezone.",
            },
            "description": {
                "type": "string",
                "description": "What the time went on, one short line.",
            },
        },
        "required": ["task_id", "duration"],
    },
    executor=_execute_log_time,
)

TIME_TOOLS: list[ToolDefinition] = [log_time]
