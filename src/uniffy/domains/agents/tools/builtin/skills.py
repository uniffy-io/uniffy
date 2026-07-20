"""Built-in skill tool: load an advertised skill's full instructions on demand."""

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_view_skill(ctx: ToolContext, args: dict) -> ToolResult:
    """Return the full instructions for a skill the agent is allowed to use."""
    from uniffy.domains.agents.cache import fetch_agent_row
    from uniffy.domains.agents.skills.operations import SkillOperations
    from uniffy.domains.agents.skills.usage import record_skill_event

    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(success=False, data="", error="name is required")

    if ctx.agent_id is None:
        return ToolResult(success=False, data="", error="Agent context not available")

    agent = await fetch_agent_row(ctx.session, ctx.agent_id, ctx.organization_id)
    if agent is None:
        return ToolResult(success=False, data="", error="Agent context not available")

    # Resolve against the agent's own skill set so view_skill can only load
    # skills that are advertised to it - not arbitrary org skills by name.
    skills = await SkillOperations(ctx.session).get_skills_for_agent(
        organization_id=ctx.organization_id,
        enabled_skill_ids=agent.enabled_skills or [],
    )
    # An org skill shadows a bundled skill of the same name: the two partial
    # unique indexes let both exist, so resolve deterministically to the
    # org-scoped row (organization_id set) over the bundled one (None).
    matches = [s for s in skills if s.name == name]
    skill = next(
        (s for s in matches if s.organization_id is not None),
        matches[0] if matches else None,
    )
    if skill is None:
        return ToolResult(
            success=False,
            data="",
            error=f"No skill named '{name}' is available to this agent.",
        )

    content = skill.content or ""
    await record_skill_event(
        ctx.session,
        skill_id=skill.id,
        skill_version=int(skill.latest_version_number or 0),
        agent_id=ctx.agent_id,
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        session_id=ctx.session_id,
        viewed=True,
    )

    if not content:
        return ToolResult(success=True, data=f"Skill '{name}' has no instructions yet.")
    return ToolResult(success=True, data=f"# {skill.display_name or skill.name}\n\n{content}")


async def _execute_propose_skill(ctx: ToolContext, args: dict) -> ToolResult:
    """Draft a new or edited skill for the user to review; never auto-activates."""
    from uniffy.domains.agents.providers.base import EventType, StreamEvent
    from uniffy.domains.agents.skills.operations import SkillOperations

    name = (args.get("name") or "").strip()
    display_name = (args.get("display_name") or "").strip() or name
    content = (args.get("content") or "").strip()
    if not name:
        return ToolResult(success=False, data="", error="name is required")
    if not content:
        return ToolResult(success=False, data="", error="content is required")

    ops = SkillOperations(ctx.session)

    # Resolve whether this proposal edits a skill the agent can see (no editing
    # arbitrary org skills). An explicit target_skill_name matches by machine
    # name or display name; failing that, a proposal whose machine name collides
    # with a visible skill is treated as an edit of it - two skills can never
    # share a name in an org, so a same-named "create" would only fail at save.
    target_skill_id = None
    kind = "create"
    if ctx.agent_id is not None:
        from uniffy.domains.agents.cache import fetch_agent_row

        agent = await fetch_agent_row(ctx.session, ctx.agent_id, ctx.organization_id)
        if agent is not None:
            visible = await ops.get_skills_for_agent(
                organization_id=ctx.organization_id,
                enabled_skill_ids=agent.enabled_skills or [],
            )
            target_name = (args.get("target_skill_name") or "").strip().lower()
            match = None
            if target_name:
                match = next(
                    (
                        s
                        for s in visible
                        if s.name.lower() == target_name
                        or (s.display_name or "").lower() == target_name
                    ),
                    None,
                )
            if match is None:
                match = next((s for s in visible if s.name.lower() == name.lower()), None)
            if match is not None:
                target_skill_id = match.id
                kind = "edit"

    scope = args.get("suggested_scope") or "personal"
    if scope not in ("personal", "organization"):
        scope = "personal"

    draft = await ops.propose_skill_draft(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        agent_id=ctx.agent_id,
        session_id=ctx.session_id,
        kind=kind,
        target_skill_id=target_skill_id,
        name=name,
        display_name=display_name,
        description=(args.get("description") or "").strip(),
        content=content,
        when_to_use=(args.get("when_to_use") or "").strip(),
        suggested_scope=scope,
        rationale=(args.get("rationale") or "").strip(),
    )

    ctx.pending_events.append(StreamEvent(type=EventType.SKILL_DRAFT, draft=draft))

    verb = "an update to" if kind == "edit" else "a new skill"
    return ToolResult(
        success=True,
        data=(
            f"Proposed {verb} '{display_name}' as a draft. It is waiting for the user to "
            "review and save - it is not active yet. Let the user know they can review it."
        ),
    )


propose_skill = ToolDefinition(
    name="skills.propose_skill",
    description=(
        "Propose a reusable skill (a set of markdown instructions) for the user to review "
        "and save. Use this when the user teaches you a repeatable workflow, a preference, or "
        "a procedure worth remembering across conversations. Do NOT propose a skill for "
        "something an advertised skill already covers - load that skill with view_skill and "
        "follow it instead. The draft is NOT active until the user reviews and saves it - tell "
        "them you have drafted it. To suggest changing an existing skill, pass its machine "
        "name as target_skill_name."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Machine name (lowercase, hyphenated), e.g. 'weekly-report'.",
            },
            "display_name": {
                "type": "string",
                "description": "Human-readable title shown in the skill library.",
            },
            "content": {
                "type": "string",
                "description": "The skill instructions as markdown.",
            },
            "description": {
                "type": "string",
                "description": "One-line summary of what the skill does.",
            },
            "when_to_use": {
                "type": "string",
                "description": "Short trigger guidance: when this skill should apply.",
            },
            "target_skill_name": {
                "type": "string",
                "description": "Machine name of an existing skill to propose editing instead.",
            },
            "suggested_scope": {
                "type": "string",
                "enum": ["personal", "organization"],
                "description": "Whether the skill is personal or shared with the organization.",
            },
            "rationale": {
                "type": "string",
                "description": "Why you are proposing this, for the reviewer.",
            },
        },
        "required": ["name", "content"],
    },
    executor=_execute_propose_skill,
    read_only=False,
)


view_skill = ToolDefinition(
    name="skills.view_skill",
    description=(
        "Load the full instructions for one of the skills advertised as available "
        "in your system prompt. Call this with the skill's name before using it, then "
        "follow the returned instructions. Skills are not tools - this is how you read one."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The machine name of the skill to load (as listed in the prompt).",
            },
        },
        "required": ["name"],
    },
    executor=_execute_view_skill,
    read_only=True,
)

SKILL_TOOLS: list[ToolDefinition] = [view_skill, propose_skill]
