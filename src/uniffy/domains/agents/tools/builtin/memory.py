"""Built-in memory tools: audience-scoped save/read/forget."""

from sqlalchemy import or_, select, update

from uniffy.core.models.agents.memory import AgentMemory, MemoryScope
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

VALID_CATEGORIES = {"preferences", "facts", "context", "instructions"}

TEST_SESSION_WRITE_ERROR = (
    "Memory writes are disabled in test sessions; nothing was saved. "
    "Reads and the memory index keep working."
)


def _test_write_guard(ctx: ToolContext) -> ToolResult | None:
    if ctx.is_test_session:
        return ToolResult(success=False, data="", error=TEST_SESSION_WRITE_ERROR)
    return None


def _scope_or_error(ctx: ToolContext) -> tuple:
    """The runtime must have resolved a scope; tools never guess an audience."""
    if ctx.agent_id is None or ctx.memory_scope is None:
        return None, ToolResult(
            success=False, data="", error="Memory scope not available for this run"
        )
    return ctx.memory_scope, None


def _audience(ref) -> str:
    from uniffy.domains.agents.memories.scope import AUDIENCE_TEXT

    return AUDIENCE_TEXT[ref.scope]


def _read_filters(ctx: ToolContext, surface_ref) -> list:
    """Read set = surface + org (+ opted-in personal); writes stay surface-only."""
    from sqlalchemy import and_

    from uniffy.domains.agents.memories.scope import MemoryScopeRef, scope_filters

    surface = scope_filters(ctx.agent_id, ctx.organization_id, surface_ref)
    if surface_ref.scope is MemoryScope.ORG:
        return surface
    groups = [and_(*surface)]
    if ctx.memory_bridge_scope is not None:
        groups.append(
            and_(
                *scope_filters(
                    ctx.agent_id, ctx.organization_id, ctx.memory_bridge_scope
                )
            )
        )
    groups.append(
        and_(
            *scope_filters(
                ctx.agent_id, ctx.organization_id, MemoryScopeRef(MemoryScope.ORG)
            )
        )
    )
    return [or_(*groups)]


async def _execute_memory_save(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.core.errors import ValidationError
    from uniffy.domains.agents.memories.operations import MemoryOperations

    guard = _test_write_guard(ctx)
    if guard:
        return guard

    ref, err = _scope_or_error(ctx)
    if err:
        return err

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

    ops = MemoryOperations(ctx.session)
    try:
        memory, created = await ops.save_from_tool(
            created_by_user_id=ctx.user_id,
            organization_id=ctx.organization_id,
            agent_id=ctx.agent_id,
            ref=ref,
            key=args.get("key", ""),
            description=args.get("description", ""),
            content=args.get("content", ""),
            category=category,
            importance=float(importance),
        )
    except ValidationError as e:
        return ToolResult(success=False, data="", error=str(e))

    verb = "saved" if created else "updated"
    return ToolResult(
        success=True,
        data=f'Memory {verb}: "{memory.key}" ({memory.category}). '
        f"This memory is {_audience(ref)}.",
    )


async def _execute_memory_read(ctx: ToolContext, args: dict) -> ToolResult:
    key = args.get("key", "").strip()
    query = args.get("query", "").strip()
    if not key and not query:
        return ToolResult(success=False, data="", error="key or query is required")

    ref, err = _scope_or_error(ctx)
    if err:
        return err

    if key:
        result = await ctx.session.execute(
            select(AgentMemory)
            .where(*_read_filters(ctx, ref), AgentMemory.key == key)
            .order_by(
                (AgentMemory.scope == MemoryScope.ORG.value).asc(),
                (AgentMemory.scope == MemoryScope.USER.value).asc(),
            )
        )
        memories = [m for m in (result.scalars().first(),) if m is not None]
        if not memories:
            return ToolResult(
                success=False, data="", error=f"No memory found with key: {key}"
            )
    else:
        pattern = f"%{query}%"
        result = await ctx.session.execute(
            select(AgentMemory)
            .where(
                *_read_filters(ctx, ref),
                (AgentMemory.key.ilike(pattern))  # type: ignore[union-attr]
                | (AgentMemory.description.ilike(pattern))  # type: ignore[union-attr]
                | (AgentMemory.content.ilike(pattern)),  # type: ignore[union-attr]
            )
            .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
            .limit(min(args.get("limit", 10), 20))
        )
        memories = list(result.scalars().all())
        if not memories:
            return ToolResult(success=True, data="No matching memories found.")

    # Own-session access counter bump: the sanctioned read_only exception.
    await ctx.session.execute(
        update(AgentMemory)
        .where(AgentMemory.id.in_([m.id for m in memories]))  # type: ignore[attr-defined]
        .values(access_count=AgentMemory.access_count + 1)
    )
    await ctx.session.commit()

    from uniffy.domains.agents.memories.scope import scope_ref_for_memory

    if key:
        memory = memories[0]
        audience = _audience(scope_ref_for_memory(memory))
        saved = (
            memory.updated_at.strftime("%Y-%m-%d") if memory.updated_at else "unknown"
        )
        return ToolResult(
            success=True,
            data=(
                f"{memory.key} [{memory.category}] ({audience}; last updated {saved}):\n"
                f"{memory.content}"
            ),
        )

    lines = [f"Found {len(memories)} memories:"]
    lines.extend(f"- [{m.category}] {m.key}: {m.content}" for m in memories)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_memory_forget(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.agents.memories.scope import scope_filters

    key = args.get("key", "").strip()
    if not key:
        return ToolResult(success=False, data="", error="key is required")

    guard = _test_write_guard(ctx)
    if guard:
        return guard

    ref, err = _scope_or_error(ctx)
    if err:
        return err

    result = await ctx.session.execute(
        select(AgentMemory).where(
            *scope_filters(ctx.agent_id, ctx.organization_id, ref),
            AgentMemory.key == key,
        )
    )
    memory = result.scalar_one_or_none()
    if not memory:
        return ToolResult(success=False, data="", error=f"No memory found with key: {key}")
    if memory.pinned:
        return ToolResult(
            success=False,
            data="",
            error="This memory is pinned by a person and cannot be deleted by a tool; "
            "ask them to unpin it first.",
        )

    from uniffy.domains.agents.cache import invalidate_memory_index

    await ctx.session.delete(memory)
    await ctx.session.commit()
    await invalidate_memory_index(ctx.agent_id, ref.scope.value, ref.cache_subject)

    return ToolResult(success=True, data=f'Memory forgotten: "{key}"')


memory_save = ToolDefinition(
    name="memory.save",
    description=(
        "Save information to remember across conversations in this space. "
        "The memory's audience matches where you are: personal in private chats, "
        "shared with the channel or session in shared spaces. If a memory with "
        "the same key exists here, it is updated."
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
            "description": {
                "type": "string",
                "description": (
                    "One-line summary shown in your memory index; write it so "
                    "future-you knows when to read this entry."
                ),
            },
            "content": {
                "type": "string",
                "description": "The full content to remember (max 4000 characters).",
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
                    "Importance weight from 0.0 to 1.0. Higher ranks the entry "
                    "earlier in your index. Default: 0.5."
                ),
            },
        },
        "required": ["key", "description", "content"],
    },
    executor=_execute_memory_save,
)

memory_read = ToolDefinition(
    name="memory.read",
    description=(
        "Read memories available in this space. Pass a key to load one "
        "entry's full content (your system prompt lists the index of keys "
        "and descriptions), or a query to search keys, descriptions, and "
        "content when the index is not enough."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "The key of the memory to read.",
            },
            "query": {
                "type": "string",
                "description": (
                    "Search query to find relevant memories when the exact "
                    "key is unknown."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Maximum search results (default 10, max 20).",
            },
        },
    },
    executor=_execute_memory_read,
    read_only=True,
)

memory_forget = ToolDefinition(
    name="memory.forget",
    description=(
        "Delete a memory saved in this space by its key. Pinned entries and "
        "organization memory cannot be deleted with this tool."
    ),
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
    memory_read,
    memory_forget,
]
