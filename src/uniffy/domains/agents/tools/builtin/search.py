"""Built-in search and people tools for agents."""

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_search_query(ctx: ToolContext, args: dict) -> ToolResult:
    """Search across all content types."""
    from uniffy.domains.search.operations import SearchOperations

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = min(args.get("limit", 10), 20)
    type_filters = args.get("type_filters")

    ops = SearchOperations(ctx.session)
    results, total = await ops.search(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        query_text=query,
        type_filters=type_filters,
        limit=limit,
    )

    if not results:
        return ToolResult(success=True, data="No results found.")

    lines = [f"Found {total} results (showing {len(results)}):"]
    for r in results:
        desc = f" - {r.description[:100]}..." if r.description else ""
        content_type = r.urn.split(":")[3] if ":" in r.urn else "UNKNOWN"
        lines.append(f"- [{content_type}] [[[{r.title}|{r.urn}]]]{desc}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_members(ctx: ToolContext, args: dict) -> ToolResult:
    """List organization members."""
    from uniffy.domains.organizations.operations import OrganizationOperations

    search_query = args.get("query")
    limit = min(args.get("limit", 20), 50)

    ops = OrganizationOperations(ctx.session)
    members_with_users, total = await ops.list_members(
        org_id=ctx.organization_id,
        page=1,
        page_size=limit,
        search=search_query,
    )

    if not members_with_users:
        return ToolResult(success=True, data="No members found.")

    lines = [f"Found {total} members (showing {len(members_with_users)}):"]
    for member, user in members_with_users:
        role = member.role.value if hasattr(member.role, "value") else str(member.role)
        urn = f"urn:uniffy:content:USER:{user.id}"
        lines.append(f"- [[[{user.full_name}|{urn}]]] ({user.email}) - {role}")

    return ToolResult(success=True, data="\n".join(lines))


# -- Tool definitions --------------------------------------------------------

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

list_members = ToolDefinition(
    name="people.list_members",
    display_name="List Members",
    group="People",
    description="List organization members. Optionally search by name or email.",
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Optional search query to filter by name or email.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results (default 20, max 50).",
            },
        },
    },
    executor=_execute_list_members,
    read_only=True,
)

SEARCH_TOOLS: list[ToolDefinition] = [search_query]
PEOPLE_TOOLS: list[ToolDefinition] = [list_members]
