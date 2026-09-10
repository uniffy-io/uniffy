"""Project shipped skills into immutable, file-backed versions."""

from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import cache_invalidate_by_tag
from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, AgentSkillStatus
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.cache import BUNDLED_SKILLS_TAG
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.skills.validation import clean_skill_write, validate_supported_surfaces
from uniffy.infrastructure.database.session import open_session, startup_advisory_lock

logger = logger.bind(component="agents.skills.bundled")

BUNDLED_LOCK_ID = 0x756E_6966_6679_5332
_METADATA_KEYS = frozenset({
    "id",
    "name",
    "display_name",
    "description",
    "requires_tools",
    "supported_surfaces",
})


async def sync_bundled_skills() -> None:
    with startup_advisory_lock(BUNDLED_LOCK_ID, "bundled skills sync"):
        async with open_session() as session:
            changed = await sync_skill_documents(session)
            await session.commit()
        if changed:
            await cache_invalidate_by_tag(BUNDLED_SKILLS_TAG)


async def sync_skill_documents(session: AsyncSession) -> bool:
    shipped: dict[UUID, dict] = {}
    names: set[str] = set()
    for doc in load_documents(DATA_DIR / "skills"):
        if doc.meta.keys() - _METADATA_KEYS:
            raise ValueError(f"{doc.path.name}: unsupported bundled skill frontmatter")
        clean = clean_skill_write(
            name=doc.scalar("name"),
            display_name=doc.scalar("display_name"),
            description=doc.scalar("description"),
            content=doc.body,
        )
        skill_id = UUID(doc.scalar("id"))
        if skill_id in shipped or clean.name in names:
            raise ValueError("Bundled skills must have unique IDs and names")
        names.add(clean.name)
        shipped[skill_id] = {
            "name": clean.name,
            "display_name": clean.display_name,
            "description": clean.description,
            "content": clean.content,
            "requires_tools": doc.items("requires_tools"),
            "supported_surfaces": validate_supported_surfaces(doc.items("supported_surfaces")),
        }

    rows = (
        await session.execute(
            select(AgentSkill, AgentSkillVersion)
            .outerjoin(
                AgentSkillVersion,
                and_(
                    AgentSkillVersion.skill_id == AgentSkill.id,
                    AgentSkillVersion.version_number == AgentSkill.latest_version_number,
                ),
            )
            .where(
                AgentSkill.source == AgentSkillSource.BUNDLED,
                AgentSkill.organization_id.is_(None),
            )
            .with_for_update(of=AgentSkill)
        )
    ).all()
    existing = {row.id: (row, version) for row, version in rows}
    by_name = {row.name: row for row, _ in rows}
    version_ops = SkillOperations(session)
    changed = False
    for skill_id, fields in shipped.items():
        row, latest = existing.get(skill_id, (None, None))
        if row is None:
            if fields["name"] in by_name:
                raise ValueError("Bundled skill name is bound to a different fixed ID")
            row = AgentSkill(
                id=skill_id,
                source=AgentSkillSource.BUNDLED,
                latest_version_number=0,
                **fields,
            )
            session.add(row)
            await session.flush()
        needs_snapshot = (
            latest is None
            or row.active_version_id is None
            or any(getattr(latest, key) != value for key, value in fields.items())
        )
        for key, value in fields.items():
            if getattr(row, key) != value:
                setattr(row, key, value)
                changed = True
        if needs_snapshot:
            await version_ops.stage_skill_version(row, author_id=None)
            changed = True
        if row.status != AgentSkillStatus.ACTIVE:
            row.status = AgentSkillStatus.ACTIVE
            changed = True

    for skill_id, (row, _) in existing.items():
        if skill_id not in shipped and row.status != AgentSkillStatus.RETIRED:
            row.status = AgentSkillStatus.RETIRED
            changed = True

    logger.info("Bundled skills reconciled", shipped_count=len(shipped), changed=changed)
    return changed
