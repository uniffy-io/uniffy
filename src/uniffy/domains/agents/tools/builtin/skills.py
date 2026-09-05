"""Draft proposals for builder review."""

from uniffy.core.models.agents.skill_draft import AgentSkillDraftKind
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


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
    kind = AgentSkillDraftKind.CREATE
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
                kind = AgentSkillDraftKind.EDIT

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
        rationale=(args.get("rationale") or "").strip(),
    )

    ctx.pending_events.append(StreamEvent(type=EventType.SKILL_DRAFT, draft=draft))

    verb = "an update to" if kind == AgentSkillDraftKind.EDIT else "a new skill"
    return ToolResult(
        success=True,
        data=(
            f"Proposed {verb} '{display_name}' as a draft. It is waiting for the user to "
            "review and save - it is not active yet. Let the user know they can review it."
        ),
    )


propose_skill = ToolDefinition(
    name="skills.propose_skill",
    display_name="Propose Skill",
    group="Skills",
    description=(
        "Propose a reusable skill (a set of markdown instructions) for the user to review "
        "and save. Use this when the user teaches you a repeatable workflow, a preference, or "
        "a procedure worth remembering across conversations. Do NOT propose a skill for "
        "something the user has already covered in an existing skill. "
        "The draft is NOT active until the user reviews and saves it - tell "
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
            "target_skill_name": {
                "type": "string",
                "description": "Machine name of an existing skill to propose editing instead.",
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


SKILL_TOOLS: list[ToolDefinition] = [propose_skill]
