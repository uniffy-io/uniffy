"""Built-in time tracking tools for agents."""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.projects.time.durations import format_minutes, parse_duration

_DURATION_DOC = "How long, as 1.5h, 1h 30m, 45m or a bare number of minutes."
_SUMMARY_GROUPS = ("day", "task", "user", "project")
_SUMMARY_URN_TYPES = {"task": "TASK", "user": "USER", "project": "PROJECT"}
DEFAULT_SUMMARY_DAYS = 7
SELF_SCOPE = "me"


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


def _summary_line(group: str, key: str, label: str, minutes: int, entries: int) -> str:
    urn_type = _SUMMARY_URN_TYPES.get(group)
    name = f"[[[{label or key}|urn:uniffy:content:{urn_type}:{key}]]]" if urn_type else key
    noun = "entry" if entries == 1 else "entries"
    return f"- {name}: {format_minutes(minutes)} ({entries} {noun})"


async def _execute_time_summary(ctx: ToolContext, args: dict) -> ToolResult:
    """Sum logged time as the acting user: their own, or a project they can view."""
    from uniffy.domains.projects.time.worklogs import AggregateGroupBy, WorklogOperations

    scope = str(args.get("scope") or SELF_SCOPE).strip()
    project_id: UUID | None = None
    user_id: UUID | None = None
    if scope.lower() == SELF_SCOPE:
        user_id = ctx.user_id
    else:
        try:
            project_id = UUID(scope)
        except ValueError:
            return ToolResult(
                success=False, data="", error="scope must be 'me' or the UUID of a project"
            )

    to_day, err = _parse_day(args.get("to"), ctx)
    if err or to_day is None:
        return ToolResult(success=False, data="", error=err or "Invalid date")
    if args.get("from"):
        from_day, err = _parse_day(args.get("from"), ctx)
        if err or from_day is None:
            return ToolResult(success=False, data="", error=err or "Invalid date")
    else:
        from_day = to_day - timedelta(days=DEFAULT_SUMMARY_DAYS - 1)
    if from_day > to_day:
        return ToolResult(success=False, data="", error="from must not be after to")

    raw_group = str(args.get("group_by") or ("task" if user_id else "user")).strip().lower()
    if raw_group not in _SUMMARY_GROUPS:
        return ToolResult(
            success=False, data="", error=f"group_by must be one of {', '.join(_SUMMARY_GROUPS)}"
        )
    group_by = AggregateGroupBy(raw_group)

    rows = await WorklogOperations(ctx.session).aggregate(
        ctx.user_id,
        ctx.organization_id,
        from_date=from_day,
        to_date=to_day,
        group_by=group_by,
        project_id=project_id,
        user_id=user_id,
    )
    total = sum(row.minutes for row in rows)
    subject = "You" if user_id else "The project"
    lines = [
        f"{subject} logged {format_minutes(total)} from {from_day.isoformat()} "
        f"to {to_day.isoformat()}, by {raw_group}."
    ]
    lines.extend(
        _summary_line(raw_group, row.key, row.label, row.minutes, row.entries) for row in rows
    )
    return ToolResult(success=True, data="\n".join(lines))


time_summary = ToolDefinition(
    name="tasks.time_summary",
    display_name="Time Summary",
    group="Tasks",
    read_only=True,
    description=(
        "Sum the time logged by the current user, or on one project they can view, over a "
        "date range, grouped by day, task, user or project."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "scope": {
                "type": "string",
                "description": "'me' for the user's own time (default), or a project UUID.",
            },
            "from": {
                "type": "string",
                "description": "First day as YYYY-MM-DD. Defaults to six days before 'to'.",
            },
            "to": {
                "type": "string",
                "description": "Last day as YYYY-MM-DD. Defaults to today in the user's timezone.",
            },
            "group_by": {
                "type": "string",
                "enum": list(_SUMMARY_GROUPS),
                "description": "Defaults to task for 'me' and to user for a project.",
            },
        },
    },
    executor=_execute_time_summary,
)

TIME_TOOLS: list[ToolDefinition] = [log_time, time_summary]
