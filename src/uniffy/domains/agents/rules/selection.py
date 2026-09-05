"""Explicit rule selection scoped to the builder's organization."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.cache import invalidate_cached_agent
from uniffy.domains.agents.rules.resolution import invalidate_rules
from uniffy.domains.agents.rules.validation import validate_rule_selection


class RuleSelectionOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: UUID, organization_id: UUID, agent_id: UUID) -> list[str]:
        await require_agents_builder(self._session, user_id, organization_id)
        if not isinstance(agent_id, UUID):
            raise ValidationError("agent_id", "An agent is required")
        agent = await AgentOperations(self._session).get_by_id(user_id, organization_id, agent_id)
        return list(agent.enabled_rules)

    async def set(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        rule_ids: list[str],
    ) -> list[str]:
        await self.get(user_id, organization_id, agent_id)
        agent = (
            await self._session.execute(
                select(Agent)
                .where(Agent.id == agent_id, Agent.organization_id == organization_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        existing = list(agent.enabled_rules)
        selected = await validate_rule_selection(
            self._session, organization_id, rule_ids, existing=existing
        )
        agent.enabled_rules = selected
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_RULES_SELECTED,
            resource_type=AuditResourceType.AGENT,
            resource_id=agent_id,
            details={"rule_ids": selected},
        )
        await self._session.commit()
        await invalidate_cached_agent(agent_id)
        await invalidate_rules(organization_id, agent_id=agent_id)
        return selected
