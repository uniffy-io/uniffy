"""Enabled rule snapshots for system prompts."""

from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID

from prometheus_client import Histogram
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import (
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
)
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.rule import AgentRule
from uniffy.core.models.agents.rule_version import AgentRuleVersion

RULE_RESOLUTION_SECONDS = Histogram(
    "uniffy_agent_rule_resolution_seconds", "Enabled rule resolution latency"
)


@dataclass(frozen=True)
class ResolvedRule:
    id: UUID
    version_id: UUID
    version_number: int
    display_name: str
    content: str


async def invalidate_rules(organization_id: UUID | None, *, agent_id: UUID | None = None) -> None:
    if agent_id is not None:
        await cache_invalidate_by_tag(f"agent_rules:{agent_id}")
    elif organization_id is None:
        await cache_invalidate_by_tag("bundled_rules")
    else:
        await cache_invalidate_by_tag(f"org_rules:{organization_id}")


async def resolve_enabled_rules(
    session: AsyncSession,
    *,
    organization_id: UUID,
    agent_id: UUID,
    enabled_rule_ids: list[str],
) -> tuple[ResolvedRule, ...]:
    if not enabled_rule_ids:
        return ()
    ids = {UUID(value) for value in enabled_rule_ids}
    # Concurrent loads for different selections must not populate the same cache.
    selection_key = sha256(",".join(sorted(str(value) for value in ids)).encode()).hexdigest()

    async def load() -> dict:
        rows = (
            await session.execute(
                select(AgentRule, AgentRuleVersion)
                .join(
                    AgentRuleVersion,
                    (AgentRule.active_version_id == AgentRuleVersion.id)
                    & (AgentRuleVersion.rule_id == AgentRule.id),
                )
                .where(
                    AgentRule.id.in_(ids),
                    or_(
                        AgentRule.organization_id == organization_id,
                        AgentRule.organization_id.is_(None),
                    ),
                )
                .order_by(AgentRule.created_at, AgentRule.id)
            )
        ).all()
        if {rule.id for rule, _ in rows} != ids:
            raise ValidationError("enabled_rules", "An enabled rule is unavailable")
        return {
            "rules": [
                {
                    "id": str(rule.id),
                    "version_id": str(version.id),
                    "version_number": version.version_number,
                    "display_name": version.display_name,
                    "content": version.content,
                }
                for rule, version in rows
            ]
        }

    with RULE_RESOLUTION_SECONDS.time():
        payload = await cache_get_or_set_locked(
            f"agent:{agent_id}:rules:{organization_id}:{selection_key}",
            load,
            ttl=900,
            tags=[f"agent_rules:{agent_id}", f"org_rules:{organization_id}", "bundled_rules"],
        )
    resolved = [
        ResolvedRule(
            id=UUID(row["id"]),
            version_id=UUID(row["version_id"]),
            version_number=row["version_number"],
            display_name=row["display_name"],
            content=row["content"],
        )
        for row in (payload or {}).get("rules", [])
    ]
    return tuple(resolved)
