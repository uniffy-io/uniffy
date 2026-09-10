"""Project shipped rule definitions without enabling them."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.rule import AgentRule, RuleSource, RuleStatus
from uniffy.domains.agents.rules.resolution import invalidate_rules
from uniffy.domains.agents.rules.validation import clean_rule_fields
from uniffy.domains.agents.rules.versions import stage_rule_version
from uniffy.infrastructure.database.session import open_session, startup_advisory_lock

logger = logger.bind(component="agents.rules.bundled")

BUNDLED_RULE_LOCK_ID = 0x756E_6966_6679_5231


async def sync_bundled_rules() -> None:
    with startup_advisory_lock(BUNDLED_RULE_LOCK_ID, "bundled rules sync"):
        async with open_session() as session:
            changed = await sync_rule_documents(session)
            await session.commit()
        if changed:
            await invalidate_rules(None)


async def sync_rule_documents(session: AsyncSession) -> bool:
    shipped: dict[UUID, dict[str, str]] = {}
    names: set[str] = set()
    for document in load_documents(DATA_DIR / "rules"):
        rule_id = UUID(document.scalar("id"))
        fields = clean_rule_fields(
            name=document.scalar("name"),
            display_name=document.scalar("display_name"),
            description=document.scalar("description"),
            content=document.body,
        )
        if rule_id in shipped or fields["name"] in names:
            raise ValueError("Bundled rules must have unique IDs and names")
        shipped[rule_id] = fields
        names.add(fields["name"])
    rows = (
        (
            await session.execute(
                select(AgentRule).where(
                    AgentRule.source == RuleSource.BUNDLED,
                )
            )
        )
        .scalars()
        .all()
    )
    existing = {row.id: row for row in rows}
    changed = False
    for rule_id, fields in shipped.items():
        row = existing.get(rule_id)
        if row is None:
            row = AgentRule(id=rule_id, source=RuleSource.BUNDLED, latest_version_number=0, **fields)
            session.add(row)
            await session.flush()
            await stage_rule_version(session, row, author_id=None)
            changed = True
        elif any(getattr(row, key) != value for key, value in fields.items()):
            for key, value in fields.items():
                setattr(row, key, value)
            await stage_rule_version(session, row, author_id=None)
            changed = True
        if row.status != RuleStatus.ACTIVE:
            row.status = RuleStatus.ACTIVE
            changed = True
    for rule_id, row in existing.items():
        if rule_id not in shipped and row.status != RuleStatus.RETIRED:
            row.status = RuleStatus.RETIRED
            changed = True
    logger.info("Bundled rules reconciled", shipped_count=len(shipped), changed=changed)
    return changed


async def resolve_bundled_rule_ids(session: AsyncSession, names: list[str]) -> dict[str, str]:
    if not names:
        return {}
    rows = (
        await session.execute(
            select(AgentRule.name, AgentRule.id).where(
                AgentRule.source == RuleSource.BUNDLED,
                AgentRule.status == RuleStatus.ACTIVE,
                AgentRule.name.in_(names),
            )
        )
    ).all()
    return {name: str(rule_id) for name, rule_id in rows}
