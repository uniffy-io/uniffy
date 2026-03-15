"""Built-in memory tools for agents."""

from datetime import UTC, datetime

from sqlalchemy import select, update

from uniffy.core.models.agents.memory import AgentMemory
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

VALID_CATEGORIES = {"preferences", "facts", "context", "instructions"}


async def _get_agent_id_for_session(ctx: ToolContext) -> str | None:
    """Get the agent_id from the session context.

    The agent_id is stored on the ToolContext by the runtime
    before tool execution begins.
    """
    return getattr(ctx, "agent_id", None)


async def _execute_memory_save(ctx: ToolContext, args: dict) -> ToolResult:
    """Save or update a memory entry."""
    key = args.get("key", "").strip()
    if not key:
        return ToolResult(success=False, data="", error="key is required")

    content = args.get("content", "").strip()
    if not content:
        return ToolResult(success=False, data="", error="content is required")

    category = args.get("category", "facts").strip().lower()
    if category not in VALID_CATEGORIES:
        return ToolResult(
            success=False,
            data="",
            error=f"Invalid category. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}",
        )

    importance = args.get("importance", 0.5)
    if not isinstance(importance, (int, float)) or importance < 0 or importance > 1:
        importance = 0.5

    agent_id = await _get_agent_id_for_session(ctx)
    if not agent_id:
        return ToolResult(success=False, data="", error="Agent context not available")

    # Check if memory with this key already exists
    result = await ctx.session.execute(
        select(AgentMemory).where(
            AgentMemory.agent_id == agent_id,
            AgentMemory.user_id == ctx.user_id,
            AgentMemory.organization_id == ctx.organization_id,
            AgentMemory.key == key,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.content = content
        existing.category = category
        existing.importance = float(importance)
        existing.updated_at = datetime.now(UTC)
        await ctx.session.commit()
        return ToolResult(
            success=True,
            data=f'Memory updated: "{key}" ({category})',
        )

    memory = AgentMemory(
        agent_id=agent_id,
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        key=key,
        content=content,
        category=category,
        importance=float(importance),
    )
    ctx.session.add(memory)
    await ctx.session.commit()

    return ToolResult(
        success=True,
        data=f'Memory saved: "{key}" ({category})',
    )


async def _execute_memory_recall(ctx: ToolContext, args: dict) -> ToolResult:
    """Search memories by content or key."""
    query = args.get("query", "").strip()
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    agent_id = await _get_agent_id_for_session(ctx)
    if not agent_id:
        return ToolResult(success=False, data="", error="Agent context not available")

    limit = min(args.get("limit", 10), 20)

    # Search by key or content using ILIKE
    search_pattern = f"%{query}%"
    result = await ctx.session.execute(
        select(AgentMemory)
        .where(
            AgentMemory.agent_id == agent_id,
            AgentMemory.user_id == ctx.user_id,
            AgentMemory.organization_id == ctx.organization_id,
            (AgentMemory.key.ilike(search_pattern))  # type: ignore[union-attr]
            | (AgentMemory.content.ilike(search_pattern)),  # type: ignore[union-attr]
        )
        .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
        .limit(limit)
    )
    memories = list(result.scalars().all())

    if not memories:
        return ToolResult(success=True, data="No matching memories found.")

    # Update access counts
    memory_ids = [m.id for m in memories]
    await ctx.session.execute(
        update(AgentMemory)
        .where(AgentMemory.id.in_(memory_ids))  # type: ignore[attr-defined]
        .values(access_count=AgentMemory.access_count + 1)
    )
    await ctx.session.commit()

    lines = [f"Found {len(memories)} memories:"]
    for m in memories:
        lines.append(f"- [{m.category}] {m.key}: {m.content}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_memory_list(ctx: ToolContext, args: dict) -> ToolResult:
    """List memories, optionally filtered by category."""
    agent_id = await _get_agent_id_for_session(ctx)
    if not agent_id:
        return ToolResult(success=False, data="", error="Agent context not available")

    category = args.get("category")
    limit = min(args.get("limit", 20), 50)

    stmt = select(AgentMemory).where(
        AgentMemory.agent_id == agent_id,
        AgentMemory.user_id == ctx.user_id,
        AgentMemory.organization_id == ctx.organization_id,
    )

    if category and category in VALID_CATEGORIES:
        stmt = stmt.where(AgentMemory.category == category)

    stmt = stmt.order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
    stmt = stmt.limit(limit)

    result = await ctx.session.execute(stmt)
    memories = list(result.scalars().all())

    if not memories:
        return ToolResult(success=True, data="No memories found.")

    lines = [f"Found {len(memories)} memories:"]
    for m in memories:
        lines.append(f"- [{m.category}] {m.key}: {m.content}")

    return ToolResult(success=True, data="\n".join(lines))


async def _execute_memory_forget(ctx: ToolContext, args: dict) -> ToolResult:
    """Delete a memory by key."""
    key = args.get("key", "").strip()
    if not key:
        return ToolResult(success=False, data="", error="key is required")

    agent_id = await _get_agent_id_for_session(ctx)
    if not agent_id:
        return ToolResult(success=False, data="", error="Agent context not available")

    result = await ctx.session.execute(
        select(AgentMemory).where(
            AgentMemory.agent_id == agent_id,
            AgentMemory.user_id == ctx.user_id,
            AgentMemory.organization_id == ctx.organization_id,
            AgentMemory.key == key,
        )
    )
    memory = result.scalar_one_or_none()

    if not memory:
        return ToolResult(success=False, data="", error=f"No memory found with key: {key}")

    await ctx.session.delete(memory)
    await ctx.session.commit()

    return ToolResult(success=True, data=f'Memory forgotten: "{key}"')


# -- Tool definitions --------------------------------------------------------

memory_save = ToolDefinition(
    name="memory.save",
    description=(
        "Save a piece of information to remember across sessions. "
        "Use this to store user preferences, important facts, project context, "
        "or custom instructions. If a memory with the same key exists, it is updated."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": (
                    "Short descriptive key for this memory "
                    "(e.g. 'preferred_format', 'project_deadline')."
                ),
            },
            "content": {
                "type": "string",
                "description": "The content to remember.",
            },
            "category": {
                "type": "string",
                "description": (
                    "Category: 'preferences', 'facts', 'context', "
                    "or 'instructions'. Default: 'facts'."
                ),
                "enum": ["preferences", "facts", "context", "instructions"],
            },
            "importance": {
                "type": "number",
                "description": (
                    "Importance weight from 0.0 to 1.0. "
                    "Higher = more likely to be recalled. Default: 0.5."
                ),
            },
        },
        "required": ["key", "content"],
    },
    executor=_execute_memory_save,
)

memory_recall = ToolDefinition(
    name="memory.recall",
    description=(
        "Search your memories for relevant information. "
        "Searches both memory keys and content. Returns matching memories "
        "ordered by importance."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query to find relevant memories.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results (default 10, max 20).",
            },
        },
        "required": ["query"],
    },
    executor=_execute_memory_recall,
)

memory_list = ToolDefinition(
    name="memory.list",
    description=(
        "List all stored memories, optionally filtered by category. "
        "Returns memories ordered by importance."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": (
                    "Filter by category: 'preferences', 'facts', 'context', or 'instructions'."
                ),
                "enum": ["preferences", "facts", "context", "instructions"],
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results (default 20, max 50).",
            },
        },
    },
    executor=_execute_memory_list,
)

memory_forget = ToolDefinition(
    name="memory.forget",
    description="Delete a specific memory by its key.",
    parameter_schema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "The key of the memory to forget.",
            },
        },
        "required": ["key"],
    },
    executor=_execute_memory_forget,
)

MEMORY_TOOLS: list[ToolDefinition] = [
    memory_save,
    memory_recall,
    memory_list,
    memory_forget,
]
