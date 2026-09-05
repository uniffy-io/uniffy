from dataclasses import replace

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.rule import AgentRule
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillStatus
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.skills import bundled
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import _provision_to


async def test_bundled_skills_preserve_exact_versions_without_creating_rules(
    scratch_database,
    monkeypatch,
):
    await _provision_to(scratch_database, "100")
    engine = create_async_engine(get_database_url())
    documents = load_documents(DATA_DIR / "skills")
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            assert await bundled.sync_skill_documents(session)
            await session.commit()
            assert not await bundled.sync_skill_documents(session)
            rows = (await session.execute(select(AgentSkill))).scalars().all()
            assert len(rows) == len(documents)
            assert all(row.active_version_id is not None for row in rows)
            row = next(row for row in rows if row.name == documents[0].scalar("name"))
            first = await session.get(AgentSkillVersion, row.active_version_id)
            assert first.content == row.content
            assert first.version_number == 1
            row.active_version_pinned = True
            await session.commit()

            changed = [replace(documents[0], body=documents[0].body + "\nUse examples.")]
            changed.extend(documents[1:])
            monkeypatch.setattr(bundled, "load_documents", lambda path: changed)
            assert await bundled.sync_skill_documents(session)
            await session.commit()
            assert row.latest_version_number == 2
            assert row.active_version_id == first.id
            assert first.content != row.content
            latest = (
                await session.execute(
                    select(AgentSkillVersion).where(
                        AgentSkillVersion.skill_id == row.id,
                        AgentSkillVersion.version_number == 2,
                    )
                )
            ).scalar_one()
            assert latest.content == changed[0].body
            assert not await bundled.sync_skill_documents(session)

            monkeypatch.setattr(bundled, "load_documents", lambda path: [])
            assert await bundled.sync_skill_documents(session)
            await session.commit()
            assert all(row.status == AgentSkillStatus.RETIRED for row in rows)
            assert await session.get(AgentSkillVersion, first.id) is first

            monkeypatch.setattr(bundled, "load_documents", lambda path: changed)
            assert await bundled.sync_skill_documents(session)
            await session.commit()
            assert row.status == AgentSkillStatus.ACTIVE
            assert row.latest_version_number == 2
            assert row.active_version_id == first.id
            assert (
                await session.execute(select(func.count()).select_from(AgentRule))
            ).scalar_one() == 0
    finally:
        await engine.dispose()
