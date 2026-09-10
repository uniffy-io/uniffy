import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, AgentSkillStatus
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.tests.integration.internal.migrations.test_skill_generation import (
    generation_db as generation_db,
)


async def test_diagnostics_use_pinned_snapshot_and_filtered_tools(generation_db):
    db = generation_db
    async with db.sessions() as session:
        skill = AgentSkill(
            organization_id=db.org.id,
            name="report",
            display_name="Recorded report",
            source=AgentSkillSource.ORGANIZATION,
            requires_tools=["notes.read_note"],
            supported_surfaces=["session"],
        )
        session.add(skill)
        await session.flush()
        ops = SkillOperations(session)
        pinned = await ops.stage_skill_version(skill, author_id=db.builder.id)
        skill.active_version_pinned = True
        skill.requires_tools = []
        skill.supported_surfaces = []
        skill.display_name = "Later report"
        await ops.stage_skill_version(skill, author_id=db.builder.id)
        skill.status = AgentSkillStatus.RETIRED
        agent = await session.get(Agent, db.agent.id)
        agent.enabled_skills = [str(skill.id), str(generate_id())]
        agent.enabled_tools = []
        await session.commit()
        diagnostics = await ops.get_skill_compatibility(
            user_id=db.builder.id, organization_id=db.org.id, agent_id=agent.id
        )
    assert diagnostics[0].version_id == pinned.id
    assert diagnostics[0].display_name == "Recorded report"
    assert diagnostics[0].missing_tools == ("notes.read_note",)
    assert diagnostics[0].unsupported_surfaces == ("chat",)
    assert diagnostics[0].retired
    assert diagnostics[1].unavailable
    db.provider.chat_completion.assert_not_awaited()


async def test_diagnostics_require_builder_and_agent_view(generation_db):
    db = generation_db
    async with db.sessions() as session:
        ops = SkillOperations(session)
        with pytest.raises(PermissionDeniedError):
            await ops.get_skill_compatibility(
                user_id=db.user.id, organization_id=db.org.id, agent_id=db.agent.id
            )
        private = Agent(
            organization_id=db.org.id,
            owner_id=db.user.id,
            name="Private",
            access_mode=AccessMode.OWNER_ONLY,
        )
        foreign = Agent(
            organization_id=db.foreign.id,
            owner_id=db.builder.id,
            name="Foreign",
        )
        session.add_all([private, foreign])
        await session.commit()
        for agent in (private, foreign):
            with pytest.raises((PermissionDeniedError, NotFoundError)):
                await ops.get_skill_compatibility(
                    user_id=db.builder.id, organization_id=db.org.id, agent_id=agent.id
                )
    db.provider.chat_completion.assert_not_awaited()
