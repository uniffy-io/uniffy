"""Rule snapshots join the caller's authoritative transaction."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.rule import AgentRule
from uniffy.core.models.agents.rule_version import AgentRuleVersion


async def stage_rule_version(
    session: AsyncSession, rule: AgentRule, *, author_id: UUID | None, change_summary: str = ""
) -> AgentRuleVersion:
    rule.latest_version_number += 1
    version = AgentRuleVersion(
        rule_id=rule.id,
        version_number=rule.latest_version_number,
        name=rule.name,
        display_name=rule.display_name,
        description=rule.description,
        content=rule.content,
        author_id=author_id,
        change_summary=change_summary[:2000],
        parent_version_id=rule.active_version_id,
    )
    session.add(version)
    if not rule.active_version_pinned:
        rule.active_version_id = version.id
    rule.updated_at = datetime.now(UTC)
    await session.flush()
    return version
