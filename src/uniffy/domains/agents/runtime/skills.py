"""Runtime skill invocation resolution."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.skill import AgentSkill
from uniffy.domains.agents.runtime.prompt import SkillPromptEntry, to_skill_prompt_entry
from uniffy.domains.agents.skills.usage import record_skill_event

logger = logger.bind(component="agents.runtime.skills")


async def resolve_invoked_skill(
    session: AsyncSession,
    *,
    skills: list[AgentSkill],
    invoked_skill_id: UUID | None,
    agent_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID | None,
) -> SkillPromptEntry | None:
    """Resolve only skills already present in the agent's authorized set."""
    if invoked_skill_id is None:
        return None
    match = next((skill for skill in skills if skill.id == invoked_skill_id), None)
    if match is None:
        logger.warning(f"Invoked skill {invoked_skill_id} not in agent's resolved set; ignoring")
        return None
    await record_skill_event(
        session,
        skill_id=match.id,
        skill_version=int(getattr(match, "latest_version_number", 0) or 0),
        agent_id=agent_id,
        user_id=user_id,
        organization_id=organization_id,
        session_id=session_id,
        invoked=True,
        commit=False,
    )
    return to_skill_prompt_entry(match)
