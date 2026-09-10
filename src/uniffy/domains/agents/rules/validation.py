"""Bounds for reusable system-prompt content."""

import re
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.rule import AgentRule, RuleStatus
from uniffy.domains.agents.memories.sanitize import strip_control_chars
from uniffy.domains.agents.skills.validation import has_hard_injection, sanitize_skill_text

MAX_ENABLED_RULES = 50


async def validate_rule_selection(
    session: AsyncSession,
    organization_id: UUID,
    rule_ids: list[str],
    *,
    existing: list[str],
) -> list[str]:
    if len(rule_ids) > MAX_ENABLED_RULES:
        raise ValidationError("rule_ids", f"Select at most {MAX_ENABLED_RULES} rules")
    try:
        ids = list(dict.fromkeys(UUID(value) for value in rule_ids))
    except ValueError as exc:
        raise ValidationError("rule_ids", "Invalid rule ID") from exc
    if not ids:
        return []
    rows = (
        (
            await session.execute(
                select(AgentRule)
                .where(
                    AgentRule.id.in_(ids),
                    or_(
                        AgentRule.organization_id == organization_id,
                        AgentRule.organization_id.is_(None),
                    ),
                )
                .order_by(AgentRule.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    if {row.id for row in rows} != set(ids):
        raise ValidationError("rule_ids", "A selected rule is unavailable")
    for row in rows:
        if row.status == RuleStatus.RETIRED and str(row.id) not in existing:
            raise ValidationError("rule_ids", "Retired rules cannot be newly enabled")
    return [str(value) for value in ids]


def clean_rule_fields(
    *, name: str, display_name: str, description: str, content: str
) -> dict[str, str]:
    fields = {
        "name": sanitize_skill_text(name),
        "display_name": sanitize_skill_text(display_name),
        "description": sanitize_skill_text(description),
        "content": sanitize_skill_text(content),
    }
    fields = {key: strip_control_chars(value, keep_newlines=True) for key, value in fields.items()}
    for key, cap in (
        ("name", 100),
        ("display_name", 255),
        ("description", 1000),
        ("content", 20000),
    ):
        if len(fields[key]) > cap:
            raise ValidationError(key, f"exceeds the {cap}-character limit")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", fields["name"]):
        raise ValidationError("name", "Use lowercase letters, numbers, underscores, or hyphens")
    if not fields["display_name"] or not fields["content"]:
        raise ValidationError("content", "Rule title and instructions are required")
    if has_hard_injection(*fields.values()):
        raise ValidationError("content", "Rule contains a disallowed system-prompt delimiter")
    return fields
