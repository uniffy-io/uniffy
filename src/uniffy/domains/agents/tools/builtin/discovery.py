"""Runtime-owned loading of deferred tool groups."""

from uniffy.domains.agents.tools.deferral import LOAD_GROUP_TOOL
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)


async def load_group(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.agents.tools.deferral import (
        LOADED_GROUPS_METADATA_KEY,
        persist_loaded_group,
    )
    from uniffy.domains.agents.tools.registry import get_tool_registry, to_api_name

    requested = str(args.get("group", "")).strip()
    if not requested:
        return ToolResult(success=False, data="", error="Missing required argument: group")

    deferred = ctx.deferred_tool_groups or {}
    match = next((g for g in deferred if g.casefold() == requested.casefold()), None)
    if match is None:
        already = next(
            (g for g in ctx.loaded_tool_groups or [] if g.casefold() == requested.casefold()),
            None,
        )
        if already is not None:
            return ToolResult(
                success=True,
                data=(f"Tool group '{already}' is already loaded; call its tools directly."),
            )
        available = ", ".join(deferred) or "none"
        return ToolResult(
            success=False,
            data="",
            error=f"Unknown tool group: {requested}. Loadable groups: {available}.",
        )

    await persist_loaded_group(ctx, match)
    names = deferred.pop(match)
    ctx.loaded_tool_groups.append(match)

    registry = get_tool_registry()
    lines = [f"Loaded tool group '{match}'. These tools are now available:"]
    for name in names:
        tool = registry.get(name)
        description = tool.description if tool else ""
        lines.append(f"- {to_api_name(name)}: {description}")
    lines.append("Call them directly from now on.")
    return ToolResult(
        success=True,
        data="\n".join(lines),
        metadata={LOADED_GROUPS_METADATA_KEY: [match]},
    )


load_group_tool = ToolDefinition(
    name=LOAD_GROUP_TOOL,
    description=(
        "Load a deferred tool group so its tools become callable. The system "
        "prompt lists the loadable groups and the tool names each one "
        "contains. Call this BEFORE concluding you cannot do something a "
        "listed group covers; after a successful load, call the loaded tools "
        "directly."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "group": {
                "type": "string",
                "description": (
                    "Group name exactly as listed in the system prompt (case-insensitive)."
                ),
            },
        },
        "required": ["group"],
    },
    executor=load_group,
    read_only=False,
    timeout_seconds=10,
    display_name="Load Tool Group",
    group="Tools",
    internal=True,
)

DISCOVERY_TOOLS = [load_group_tool]
