import pytest
from psycopg2 import errorcodes, errors
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, AgentSkillStatus
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import generate_id
from uniffy.core.errors import ValidationError
from uniffy.domains.agents.skills import resolution
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.skills.resolution import SkillInvocationError, SkillSurface
from uniffy.domains.agents.skills.validation import validate_skill_selection
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _provision_to,
    _migrate_to,
    _query,
    _execute,
)

# psycopg2 builds its exception classes at runtime; look the class up by SQLSTATE.
CheckViolation = errors.lookup(errorcodes.CHECK_VIOLATION)


async def test_skill_cutover_preserves_content_history_and_assignments(scratch_database):
    await _provision_to(scratch_database, "097")
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            org = Organization(name="Skills", slug="skills")
            user = User(username="builder", email="builder@example.test")
            session.add_all([org, user])
            await session.flush()
            skill_id, version_id = generate_id(), generate_id()
            await session.execute(
                text(
                    "INSERT INTO agents_skills "
                    "(id, organization_id, name, display_name, source, content, "
                    "always_active, when_to_use, requires_context, active_version_id, created_at) "
                    "VALUES (:id, :org, 'release', 'Release', 'organization', 'Head body', "
                    "true, 'Automatic guidance', '[\"chat\"]', :version, now())"
                ),
                {"id": skill_id, "org": org.id, "version": version_id},
            )
            await session.execute(
                text(
                    "INSERT INTO agents_skill_versions "
                    "(id, skill_id, version_number, name, display_name, content, when_to_use, "
                    "requires_context) VALUES (:id, :skill, 1, 'release', 'Release', "
                    "'Pinned body', 'Version guidance', '[\"chat\"]')"
                ),
                {"id": version_id, "skill": skill_id},
            )
            await session.execute(
                text(
                    "INSERT INTO agents_skill_drafts "
                    "(id, organization_id, owner_id, target_skill_id, kind, content, "
                    "suggested_always_active, when_to_use, requires_context) VALUES "
                    "(:id, :org, :owner, :skill, 'edit', 'Draft body', true, "
                    "'Draft guidance', '[\"session\"]')"
                ),
                {"id": generate_id(), "org": org.id, "owner": user.id, "skill": skill_id},
            )
            await session.execute(
                text(
                    "INSERT INTO agents_agents (id, organization_id, owner_id, name, enabled_skills) "
                    "VALUES (:id, :org, :owner, 'Assigned', jsonb_build_array(CAST(:skill AS text)))"
                ),
                {"id": generate_id(), "org": org.id, "owner": user.id, "skill": str(skill_id)},
            )
            session.add_all([
                OrgSetting(organization_id=org.id, namespace=namespace, key=key, value=value)
                for namespace, key, value in (
                    ("agents", "enabled_rules", [str(generate_id())]),
                    ("agents", "skill_evolution_enabled", True),
                    ("agents", "runtime", {"keep": True}),
                    ("other", "enabled_rules", ["keep"]),
                    ("other", "skill_evolution_enabled", True),
                )
            ])
            await session.commit()
    finally:
        await engine.dispose()

    tables = ("agents_skills", "agents_skill_versions", "agents_skill_drafts")
    before = {
        table: _query(f"SELECT id, content, requires_context FROM {table}") for table in tables
    }
    assignments = _query("SELECT id, enabled_skills FROM agents_agents")
    _migrate_to("098")
    for table in tables:
        assert _query(f"SELECT id, content, supported_surfaces FROM {table}") == before[table]
        with pytest.raises(CheckViolation):
            _execute(f"UPDATE {table} SET supported_surfaces = '[\"unknown\"]'::jsonb")
    assert _query("SELECT id, enabled_skills FROM agents_agents") == assignments
    assert _query("SELECT enabled_rules FROM agents_agents") == [([],)]
    assert _query("SELECT namespace, key, value FROM org_settings ORDER BY namespace, key") == [
        ("agents", "runtime", {"keep": True}),
        ("other", "enabled_rules", ["keep"]),
        ("other", "skill_evolution_enabled", True),
    ]
    assert _query("SELECT count(*) FROM agents_rules") == [(0,)]
    assert _query("SELECT count(*) FROM agents_rule_versions") == [(0,)]
    assert (
        _query(
            "SELECT column_name FROM information_schema.columns WHERE table_name IN "
            "('agents_skills', 'agents_skill_versions', 'agents_skill_drafts') AND column_name IN "
            "('always_active', 'when_to_use', 'suggested_always_active', 'requires_context')"
        )
        == []
    )


async def test_exact_skill_snapshot_respects_assignment_tenant_and_pin(
    scratch_database, monkeypatch
):

    await _provision_to(scratch_database, "098")

    async def uncached(key, loader, **kwargs):
        return await loader()

    monkeypatch.setattr(resolution, "cache_get_or_set_locked", uncached)
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            first = Organization(name="First", slug="first")
            second = Organization(name="Second", slug="second")
            session.add_all([first, second])
            await session.flush()
            skill = AgentSkill(
                organization_id=first.id,
                source=AgentSkillSource.ORGANIZATION,
                name="report",
                display_name="Report",
                content="Pinned body",
                requires_tools=["search.query"],
                supported_surfaces=["chat"],
                latest_version_number=0,
            )
            session.add(skill)
            await session.flush()
            ops = SkillOperations(session)
            pinned = await ops.stage_skill_version(skill, author_id=None)
            skill.active_version_pinned = True
            skill.content = "Latest body"
            skill.requires_tools = ["notes.create_note"]
            skill.supported_surfaces = ["session"]
            await ops.stage_skill_version(skill, author_id=None)
            skill.status = AgentSkillStatus.RETIRED
            await session.commit()
            args = dict(
                organization_id=first.id,
                enabled_skill_ids=[str(skill.id)],
                invoked_skill_id=skill.id,
                surface=SkillSurface.CHAT,
                executable_tools=frozenset({"search.query"}),
            )
            resolved = await resolution.resolve_skill_invocation(session, **args)
            assert resolved.version_id == pinned.id
            assert resolved.version_number == 1
            assert resolved.content == "Pinned body"
            assert skill.content == "Latest body"
            assert not session.dirty
            assert await ops.resolve_active_version_numbers([skill]) == {skill.id: 1}
            assert (await ops._load_active_version(skill)).id == pinned.id
            summaries = await resolution.resolve_assigned_skill_summaries(
                session, organization_id=first.id, enabled_skill_ids=[str(skill.id)]
            )
            assert [summary.version_id for summary in summaries] == [pinned.id]
            assert not hasattr(summaries[0], "content")
            assert skill.content == "Latest body"
            assert not session.dirty
            with pytest.raises(SkillInvocationError, match="unavailable"):
                await resolution.resolve_skill_invocation(
                    session, **{**args, "organization_id": second.id}
                )
            with pytest.raises(SkillInvocationError, match="unavailable"):
                await resolution.resolve_skill_invocation(
                    session, **{**args, "enabled_skill_ids": []}
                )

            other = AgentSkill(
                organization_id=second.id,
                source=AgentSkillSource.ORGANIZATION,
                name="report",
                display_name="Other report",
                content="Other tenant body",
                latest_version_number=0,
            )
            session.add(other)
            await session.flush()
            other_version = await ops.stage_skill_version(other, author_id=None)
            skill.active_version_id = other_version.id
            await session.commit()
            with pytest.raises(ValidationError, match="unavailable"):
                await ops.resolve_active_version_numbers([skill])
            with pytest.raises(ValidationError, match="unavailable"):
                await ops._load_active_version(skill)
            assert (
                await resolution.resolve_assigned_skill_summaries(
                    session, organization_id=first.id, enabled_skill_ids=[str(skill.id)]
                )
                == []
            )
            with pytest.raises(SkillInvocationError, match="unavailable"):
                await resolution.resolve_skill_invocation(session, **args)
            skill.active_version_id = None
            await session.commit()
            with pytest.raises(SkillInvocationError, match="unavailable"):
                await resolution.resolve_skill_invocation(session, **args)
    finally:
        await engine.dispose()


async def test_skill_selection_enforces_tenant_scope_and_retirement(scratch_database):
    await _provision_to(scratch_database, "098")
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            first = Organization(name="First", slug="first")
            second = Organization(name="Second", slug="second")
            session.add_all([first, second])
            await session.flush()
            own = AgentSkill(
                organization_id=first.id,
                source=AgentSkillSource.ORGANIZATION,
                name="own",
                display_name="Own",
            )
            foreign = AgentSkill(
                organization_id=second.id,
                source=AgentSkillSource.ORGANIZATION,
                name="foreign",
                display_name="Foreign",
            )
            bundled = AgentSkill(
                source=AgentSkillSource.BUNDLED, name="bundled", display_name="Bundled"
            )
            retired = AgentSkill(
                organization_id=first.id,
                source=AgentSkillSource.ORGANIZATION,
                name="retired",
                display_name="Retired",
                status=AgentSkillStatus.RETIRED,
            )
            session.add_all([own, foreign, bundled, retired])
            await session.commit()
            selected = await validate_skill_selection(
                session, first.id, [own.id.hex.upper(), str(bundled.id), str(own.id)], existing=[]
            )
            assert selected == [str(own.id), str(bundled.id)]
            for unavailable in (foreign.id, generate_id()):
                with pytest.raises(ValidationError, match="unavailable"):
                    await validate_skill_selection(
                        session, first.id, [str(unavailable)], existing=[]
                    )
            with pytest.raises(ValidationError, match="Retired"):
                await validate_skill_selection(session, first.id, [str(retired.id)], existing=[])
            assert await validate_skill_selection(
                session, first.id, [str(retired.id)], existing=[str(retired.id)]
            ) == [str(retired.id)]
    finally:
        await engine.dispose()
