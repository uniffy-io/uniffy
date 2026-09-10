from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.models.login.organization import Organization
from uniffy.domains.agents.rules.resolution import resolve_enabled_rules
from uniffy.domains.agents.runtime.capabilities import resolve_executable_tool_schemas
from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.runtime.tooling import allowed_tool_names
from uniffy.domains.agents.skills.evaluations.schemas import MAX_PROMPT_CHARACTERS
from uniffy.domains.agents.skills.resolution import ResolvedSkill, _validate_requirements
from uniffy.domains.integrations.advertisement import has_advertised_integration_tools


async def capture_configuration(
    session: AsyncSession,
    *,
    organization_id: UUID,
    agent: Agent,
    skill: dict,
    model_override: str,
    judge_model: str,
) -> dict:
    if len(model_override) > 255 or len(judge_model) > 255:
        raise ValidationError("model", "Model identifier is too long")
    schemas = await resolve_executable_tool_schemas(
        session, organization_id=organization_id, agent=agent
    )
    resolved = ResolvedSkill(**{
        **skill,
        "id": UUID(skill["id"]),
        "version_id": UUID(skill["version_id"]),
        "requires_tools": tuple(skill["requires_tools"]),
        "supported_surfaces": tuple(SkillSurface(value) for value in skill["supported_surfaces"]),
    })
    surface = next(iter(resolved.supported_surfaces), SkillSurface.SESSION)
    _validate_requirements(resolved, surface, allowed_tool_names(schemas))
    rules = await resolve_enabled_rules(
        session,
        organization_id=organization_id,
        agent_id=agent.id,
        enabled_rule_ids=agent.enabled_rules or [],
    )
    organization = await session.get(Organization, organization_id)
    system_prompt = build_system_prompt(
        agent_name=agent.name,
        soul_prompt=agent.soul_prompt or "",
        org_name=organization.name,
        rules=rules,
        invoked_skill=resolved,
        external_content_note=has_advertised_integration_tools(schemas),
    )
    if len(system_prompt) > MAX_PROMPT_CHARACTERS or len(dumps_bytes(schemas)) > 400000:
        raise ValidationError("evaluation", "The evaluation configuration exceeds its size limit")
    return {
        "skill": skill,
        "system_prompt": system_prompt,
        "schemas": schemas,
        "rule_version_ids": [str(rule.version_id) for rule in rules],
        "surface": surface,
        "agent": {
            "name": agent.name,
            "primary_model": agent.primary_model,
            "fallback_models": list(agent.fallback_models or []),
            "model_params": dict(agent.model_params or {}),
        },
        "model_override": model_override,
        "judge_model": judge_model,
    }
