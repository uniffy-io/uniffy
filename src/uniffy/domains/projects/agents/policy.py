"""Per-org switch for handing tasks to agents, stored in the shared ``org_settings`` store."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import ValidationError
from uniffy.domains.projects.time.policy import PROJECTS_NAMESPACE

AGENT_POLICY_KEY = "agent_policy"


@dataclass(frozen=True)
class ResolvedAgentPolicy:
    organization_id: UUID
    agent_assignment_enabled: bool = True


async def load_agent_policy(session: AsyncSession, organization_id: UUID) -> ResolvedAgentPolicy:
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, PROJECTS_NAMESPACE)
    row = rows.get(AGENT_POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ResolvedAgentPolicy(organization_id=organization_id)
    return ResolvedAgentPolicy(
        organization_id=organization_id,
        agent_assignment_enabled=bool(row.value.get("agent_assignment_enabled", True)),
    )


async def save_agent_policy(
    session: AsyncSession, *, policy: ResolvedAgentPolicy, updated_by_user_id: UUID
) -> None:
    """Upsert the blob; the caller commits it together with its audit row."""
    await OrgSettingsOperations(session).set(
        organization_id=policy.organization_id,
        namespace=PROJECTS_NAMESPACE,
        key=AGENT_POLICY_KEY,
        value={"agent_assignment_enabled": policy.agent_assignment_enabled},
        updated_by_user_id=updated_by_user_id,
    )


def require_agent_assignment_enabled(policy: ResolvedAgentPolicy) -> None:
    if not policy.agent_assignment_enabled:
        raise ValidationError(
            "agent_id", "Assigning tasks to agents is turned off for this organization"
        )
