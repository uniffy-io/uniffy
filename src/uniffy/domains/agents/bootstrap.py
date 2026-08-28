"""Stage the default agent created with an organization."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.agents.templates import get_default_template


@dataclass(frozen=True)
class StagedDefaultAgent:
    agent: Agent


async def stage_default_agent(
    session: AsyncSession,
    organization_id: UUID,
    owner_user_id: UUID,
) -> StagedDefaultAgent:
    template = get_default_template()
    skill_rows = (
        await session.execute(
            select(AgentSkill.id, AgentSkill.name).where(
                AgentSkill.organization_id.is_(None),
                AgentSkill.source == AgentSkillSource.BUNDLED,
                AgentSkill.name.in_(template.bundled_skill_names),
            )
        )
    ).all()
    skill_id_by_name = {name: str(skill_id) for skill_id, name in skill_rows}
    agent = Agent(
        organization_id=organization_id,
        owner_id=owner_user_id,
        name=template.name,
        soul_prompt=template.soul_prompt,
        enabled_tools=list(template.enabled_tools),
        enabled_skills=[
            skill_id_by_name[name]
            for name in template.bundled_skill_names
            if name in skill_id_by_name
        ],
        avatar_emoji=template.emoji,
        is_default=True,
        access_mode=AccessMode.OPEN_TO_ORG,
    )
    session.add(agent)
    await session.flush()
    return StagedDefaultAgent(agent)


async def finish_default_agent_after_commit(
    session: AsyncSession,
    staged: StagedDefaultAgent,
) -> None:
    agent = staged.agent
    await SearchIndexer(session).index(
        urn=build_content_urn(ContentType.AGENT, agent.id),
        organization_id=agent.organization_id,
        title=agent.name,
        entity_type=ContentType.AGENT.value,
        url_path=f"/agents/{agent.id}",
        access_mode=agent.access_mode.value if agent.access_mode is not None else None,
        baseline_role=(agent.baseline_role.value if agent.baseline_role is not None else None),
        owner_id=agent.owner_id,
        keywords=" ".join([agent.name, agent.soul_prompt[:500]]),
        description=agent.soul_prompt[:200] if agent.soul_prompt else None,
        metadata={"emoji": agent.avatar_emoji} if agent.avatar_emoji else None,
    )
