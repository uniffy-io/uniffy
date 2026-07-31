"""Built-in system/utility tools for agents."""

from datetime import UTC, datetime

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_current_time(ctx: ToolContext, args: dict) -> ToolResult:
    """Return the current wall-clock time in UTC.

    The system prompt only carries a date snapshot from when the turn began;
    this tool gives the model the real current instant on demand.
    """
    now = datetime.now(UTC)
    return ToolResult(
        success=True,
        data=(
            f"Current UTC time: {now.isoformat(timespec='seconds')} "
            f"({now.strftime('%A, %d %B %Y %H:%M:%S')} UTC)"
        ),
    )


current_time = ToolDefinition(
    name="system.current_time",
    display_name="Current Time (UTC)",
    group="System",
    description=(
        "Get the current date and time in UTC. Use this whenever you need the "
        "real current time rather than the date snapshot in the conversation context."
    ),
    parameter_schema={"type": "object", "properties": {}},
    executor=_execute_current_time,
    read_only=True,
    timeout_seconds=5,
)

SYSTEM_TOOLS: list[ToolDefinition] = [current_time]
