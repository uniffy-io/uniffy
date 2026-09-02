"""Built-in workspace search tools for agents."""

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_search_query(ctx: ToolContext, args: dict) -> ToolResult:
    """Search across all content types."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = min(args.get("limit", 10), 20)
    type_filters = args.get("type_filters")

    ops = SearchOperations(ctx.session, ctx.search)
    results, has_more, _next_offset = await ops.search(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        query_text=query,
        type_filters=type_filters,
        limit=limit,
    )

    if not results:
        return ToolResult(success=True, data="No results found.")

    suffix = " (more available)" if has_more else ""
    lines = [f"Found {len(results)} results{suffix}:"]
    for r in results:
        desc = f" - {r.description[:100]}..." if r.description else ""
        content_type = r.urn.split(":")[3] if ":" in r.urn else "UNKNOWN"  # noqa: PLR2004
        lines.append(f"- [{content_type}] [[[{r.title}|{r.urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


search_query = ToolDefinition(
    name="search.query",
    display_name="Search Content",
    group="Search",
    description=(
        "Search across all content types (notes, files, projects, tasks, events, users). "
        "Returns matching items with titles and URNs."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query text.",
            },
            "type_filters": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional content type filters (e.g. ['note', 'task', 'file']). "
                    "Omit to search all types."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results (default 10, max 20).",
            },
        },
        "required": ["query"],
    },
    executor=_execute_search_query,
    read_only=True,
    timeout_seconds=30,
)

SEARCH_TOOLS: list[ToolDefinition] = [search_query]
