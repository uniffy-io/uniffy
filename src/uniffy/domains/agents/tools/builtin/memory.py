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
    from uniffy.domains.agents.memories.scope import audience_text

    return audience_text(ref)


def _read_filters(ctx: ToolContext, surface_ref) -> list:
    """Read set = surface + both org tiers (+ opted-in personal); writes stay surface-only."""
    from sqlalchemy import and_

    from uniffy.domains.agents.memories.scope import MemoryScopeRef, scope_filters

    refs = [surface_ref, MemoryScopeRef.org(), MemoryScopeRef.org(ctx.agent_id)]
    if ctx.memory_bridge_scope is not None:
        refs.append(ctx.memory_bridge_scope)
    groups = [and_(*scope_filters(ctx.organization_id, ref)) for ref in refs]
    return [or_(*groups)]


VALID_AUDIENCES = {"space", "personal", "organization"}


async def _resolve_save_ref(ctx: ToolContext, surface_ref, audience: str):
    """Map the requested audience onto a writable bucket, or explain why not.

    The surface stays the default; an explicit audience either matches a
    bucket the requesting HUMAN may write (org memory follows the builder
    gate, exactly like the UI) or comes back as a structured refusal - never
    a silent save to the wrong audience.
    """
    from uniffy.domains.agents.access import is_agents_builder
    from uniffy.domains.agents.memories.scope import MemoryScopeRef

    if audience == "organization":
        if not await is_agents_builder(
            ctx.session, ctx.user_id, ctx.organization_id
        ):
            return None, ToolResult(
                success=False,
                data="",
                error=(
                    "Nothing was saved: organization memory is managed by "
                    "agent builders (org admins and AGENTS domain admins), and "
                    "the requesting user does not have that role. Offer to "
                    "save it for this space instead, or suggest asking a "
                    "builder to add it to organization memory."
                ),
            )
        return MemoryScopeRef.org(), None
    if audience == "personal" and ctx.memory_scope.scope is not MemoryScope.USER:
        return None, ToolResult(
            success=False,
            data="",
            error=(
                "Nothing was saved: this is a shared space, so a personal "
                "memory cannot be written from here. Point the user to a "
                "direct 1:1 chat with an agent to save personal memory."
            ),
        )
    return surface_ref, None


async def _execute_memory_save(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.core.errors import ValidationError
    from uniffy.domains.agents.memories.operations import MemoryOperations

    guard = _test_write_guard(ctx)
    if guard:
        return guard

    ref, err = _scope_or_error(ctx)
    if err:
        return err

    audience = str(args.get("audience") or "space").strip().lower()
    if audience not in VALID_AUDIENCES:
        return ToolResult(
            success=False,
            data="",
            error=f"Invalid audience. Must be one of: {', '.join(sorted(VALID_AUDIENCES))}",
        )
    ref, err = await _resolve_save_ref(ctx, ref, audience)
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
            created_by_agent_id=ctx.agent_id,
            organization_id=ctx.organization_id,
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
        from uniffy.domains.agents.memories.sanitize import escape_like

        pattern = f"%{escape_like(query)}%"
        result = await ctx.session.execute(
            select(AgentMemory)
            .where(
                *_read_filters(ctx, ref),
                (AgentMemory.key.ilike(pattern, escape="\\"))  # type: ignore[union-attr]
                | (AgentMemory.description.ilike(pattern, escape="\\"))  # type: ignore[union-attr]
                | (AgentMemory.content.ilike(pattern, escape="\\")),  # type: ignore[union-attr]
            )
            .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
            .limit(min(args.get("limit", 10), 20))
        )
        memories = list(result.scalars().all())
        if not memories:
            return ToolResult(success=True, data="No matching memories found.")

    if not ctx.memory_recall_promoted:
        from uniffy.domains.agents.memories.scoring import script_class
        from uniffy.observability.metrics import (
            AGENT_MEMORY_READ_AFTER_NO_RECALL_TOTAL,
        )

        AGENT_MEMORY_READ_AFTER_NO_RECALL_TOTAL.labels(
            script=script_class(query or key)
        ).inc()

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
            *scope_filters(ctx.organization_id, ref),
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
    await invalidate_memory_index(ctx.organization_id, ref)

    return ToolResult(success=True, data=f'Memory forgotten: "{key}"')


memory_save = ToolDefinition(
    name="memory.save",
    display_name="Save Memory",
    group="Memory",
    description=(
        "Save information to remember across conversations. By default the "
        "memory's audience matches where you are: the user's personal "
        "memory in private chats, the channel's or session's memory in shared "
        "spaces. When the user names a DIFFERENT audience (e.g. 'remember "
        "this for the organization', 'just for me'), pass it in `audience` - "
        "never save to the default audience when they asked for another one; "
        "the tool checks their permission and tells you what to do if it is "
        "not allowed. Every assistant the audience talks to reads what you "
        "save, so write it for them too. If a memory with the same key exists "
        "in the target audience, it is updated."
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
                    "One-line trigger shown in your memory index, written in "
                    "the conversation's language. State WHEN to read the "
                    "entry, e.g. 'read this when scheduling or releases "
                    "come up'."
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
            "audience": {
                "type": "string",
                "enum": ["space", "personal", "organization"],
                "description": (
                    "Who the memory is for. 'space' (default): this "
                    "conversation's audience. 'personal': only valid in a "
                    "private 1:1 surface. 'organization': org-wide memory, "
                    "saved only when the requesting user is an agent builder "
                    "- otherwise the save is refused with guidance. Set this "
                    "whenever the user names an audience."
                ),
            },
        },
        "required": ["key", "description", "content"],
    },
    executor=_execute_memory_save,
)

memory_read = ToolDefinition(
    name="memory.read",
    display_name="Read Memory",
    group="Memory",
    description=(
        "Read memories available in this space, including what other "
        "assistants saved for this audience and the organization's memory. "
        "Pass a key to load one "
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
    display_name="Forget Memory",
    group="Memory",
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
