"""Record explicit invocation usage after exact-version validation."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.domains.agents.skills.resolution import (
    ResolvedSkill,
    SkillSurface,
    resolve_skill_invocation,
)
from uniffy.domains.agents.skills.usage import record_skill_event


async def resolve_invoked_skill(
    session: AsyncSession,
    *,
    enabled_skill_ids: list[str],
    invoked_skill_id: UUID | None,
    executable_tools: frozenset[str],
    surface: SkillSurface,
    agent_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID | None,
) -> ResolvedSkill | None:
    skill = await resolve_skill_invocation(
        session,
        organization_id=organization_id,
        enabled_skill_ids=enabled_skill_ids,
        invoked_skill_id=invoked_skill_id,
        surface=surface,
        executable_tools=executable_tools,
    )
    if skill is None:
        return None
    await record_skill_event(
        session,
        skill_id=skill.id,
        skill_version=skill.version_number,
        agent_id=agent_id,
        user_id=user_id,
        organization_id=organization_id,
        session_id=session_id,
        invoked=True,
        commit=False,
    )
    return skill
