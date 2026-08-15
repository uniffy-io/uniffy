"""Sync the shipped agent skills in `uniffy/data/skills/` into the database.

Bundled skills are shipped content that orgs cannot edit, so the markdown files
are the source of truth and the rows are a projection of them. Each file carries
a fixed `id`, which keeps a bundled skill the same entity on every deployment -
agent configs reference those ids, so generating them per install would make the
same skill a different row in every tenant.
"""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.data_files import DATA_DIR, load_documents

logger = logger.bind(component="db.bundled_skills")

BUNDLED_LOCK_ID = 0x756E_6966_6679_5332  # "unifyS2"


async def sync_bundled_skills() -> None:
    """Reconcile the bundled skill rows with the shipped files.

    Runs on every startup, ahead of the initial seed, so a release that adds or
    edits a skill reaches deployments that were provisioned long ago.
    """
    from uniffy.db.session import open_session, startup_advisory_lock

    with startup_advisory_lock(BUNDLED_LOCK_ID, "bundled skills sync"):
        async with open_session() as session:
            await _sync_locked(session)
            await session.commit()


async def _sync_locked(session: AsyncSession) -> None:
    from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, AgentSkillStatus

    documents = load_documents(DATA_DIR / "skills")
    shipped: dict[UUID, dict[str, str]] = {}
    for doc in documents:
        shipped[UUID(doc.scalar("id"))] = {
            "name": doc.scalar("name"),
            "display_name": doc.scalar("display_name"),
            "description": doc.scalar("description"),
            "content": doc.body,
        }

    result = await session.execute(select(AgentSkill).where(AgentSkill.organization_id.is_(None)))
    rows = list(result.scalars().all())
    existing = {row.id: row for row in rows}
    by_name = {row.name: row for row in rows}

    added, updated, retired = 0, 0, 0

    for skill_id, fields in shipped.items():
        row = existing.get(skill_id)
        if row is None:
            claimed = by_name.get(fields["name"])
            if claimed is not None:
                # A row predating the fixed ids. Inserting would trip
                # uq_agents_skills_bundled_name, and repointing it would orphan
                # the id in every agent's enabled_skills, so leave it alone:
                # lookups resolve by name, so the deployment still works.
                logger.error(
                    f"Bundled skill {fields['name']} exists as {claimed.id}, "
                    f"shipped id is {skill_id}. Content not synced. Reset the "
                    f"database to adopt the shipped ids."
                )
                continue
            session.add(
                AgentSkill(
                    id=skill_id,
                    organization_id=None,
                    source=AgentSkillSource.BUNDLED,
                    always_active=False,
                    **fields,
                )
            )
            added += 1
            continue

        changed = any(getattr(row, key) != value for key, value in fields.items())
        if changed or row.status != AgentSkillStatus.ACTIVE:
            for key, value in fields.items():
                setattr(row, key, value)
            row.status = AgentSkillStatus.ACTIVE
            updated += 1

    shipped_names = {fields["name"] for fields in shipped.values()}
    for skill_id, row in existing.items():
        if skill_id in shipped or row.name in shipped_names:
            continue
        if row.status != AgentSkillStatus.RETIRED:
            # Dropping the row would cascade its versions and silently strip the
            # id out of every agent's enabled_skills; retiring only hides it from
            # the pickers while agents that already use it keep working.
            row.status = AgentSkillStatus.RETIRED
            retired += 1
            logger.warning(f"Bundled skill {row.name} no longer shipped, retired")

    logger.info(
        f"Bundled skills synced: {added} added, {updated} updated, "
        f"{retired} retired, {len(shipped)} shipped"
    )
