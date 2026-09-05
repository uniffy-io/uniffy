from dataclasses import replace

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.rule import AgentRule, RuleSource, RuleStatus
from uniffy.core.models.agents.rule_version import AgentRuleVersion
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import generate_id
from uniffy.domains.agents.rules import bundled, resolution
from uniffy.domains.agents.rules.versions import stage_rule_version
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import _provision_to, _query


async def test_rules_are_per_agent_and_migration_removes_only_global_selection(
    scratch_database,
    monkeypatch,
):
    await _provision_to(scratch_database, "098")
    monkeypatch.setattr(resolution, "cache_get_or_set_locked", _uncached)
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            org = Organization(name="Rules", slug="rules")
            user = User(username="builder", email="builder@example.test")
            session.add_all([org, user])
            await session.flush()
            rule = AgentRule(
                organization_id=org.id,
                source=RuleSource.ORGANIZATION,
                name="selected",
                display_name="Selected",
                content="Only on the selected agent",
                latest_version_number=0,
            )
            session.add(rule)
            await session.flush()
            await stage_rule_version(session, rule, author_id=user.id)
            first = Agent(
                organization_id=org.id,
                owner_id=user.id,
                name="First",
                enabled_rules=[str(rule.id)],
            )
            second = Agent(organization_id=org.id, owner_id=user.id, name="Second")
            session.add_all([
                first,
                second,
                OrgSetting(
                    organization_id=org.id,
                    namespace="agents",
                    key="enabled_rules",
                    value=[str(rule.id)],
                ),
                OrgSetting(
                    organization_id=org.id, namespace="agents", key="runtime", value={"keep": True}
                ),
            ])
            await session.commit()
            assert (
                await resolution.resolve_enabled_rules(
                    session,
                    organization_id=org.id,
                    agent_id=second.id,
                    enabled_rule_ids=[],
                )
                == ()
            )
            selected = await resolution.resolve_enabled_rules(
                session,
                organization_id=org.id,
                agent_id=first.id,
                enabled_rule_ids=first.enabled_rules,
            )
            assert [entry.id for entry in selected] == [rule.id]
            before = _query("SELECT id, enabled_rules FROM agents_agents ORDER BY id")
        config = Config(str(ALEMBIC_INI_PATH))
        config.attributes["configure_logger"] = False
        command.upgrade(config, "099")
        assert _query("SELECT id, enabled_rules FROM agents_agents ORDER BY id") == before
        assert _query("SELECT key FROM org_settings WHERE namespace = 'agents'") == [("runtime",)]
        assert _query("SELECT count(*) FROM agents_rules") == [(1,)]
        assert _query("SELECT count(*) FROM agents_rule_versions") == [(1,)]
    finally:
        await engine.dispose()


async def _uncached(key, loader, **kwargs):
    return await loader()


async def test_rule_migration_and_bundled_snapshot_lifecycle(scratch_database, monkeypatch):
    await _provision_to(scratch_database, "098")
    assert _query("SELECT count(*) FROM agents_rules") == [(0,)]
    engine = create_async_engine(get_database_url())
    docs = load_documents(DATA_DIR / "rules")
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            assert await bundled.sync_rule_documents(session)
            await session.commit()
            assert not await bundled.sync_rule_documents(session)
            rule = (await session.execute(select(AgentRule))).scalars().first()
            first_id = rule.active_version_id
            assert rule.latest_version_number == 1
            assert (
                await session.execute(select(func.count()).select_from(OrgSetting))
            ).scalar_one() == 0

            changed = [replace(doc, body=doc.body + "\nUse concrete examples.") for doc in docs]
            monkeypatch.setattr(bundled, "load_documents", lambda path: changed)
            assert await bundled.sync_rule_documents(session)
            await session.commit()
            assert rule.latest_version_number == 2
            assert rule.active_version_id != first_id
            original = await session.get(AgentRuleVersion, first_id)
            assert "Use concrete examples." not in original.content

            monkeypatch.setattr(bundled, "load_documents", lambda path: [])
            assert await bundled.sync_rule_documents(session)
            await session.commit()
            assert rule.status == RuleStatus.RETIRED
            assert await session.get(AgentRuleVersion, first_id) is not None
    finally:
        await engine.dispose()

    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "097")
    assert _query("SELECT to_regclass('agents_rules')") == [(None,)]
    command.upgrade(config, "098")
    assert _query("SELECT count(*) FROM agents_rules") == [(0,)]


async def test_rule_resolution_isolates_tenants_and_uses_pinned_body(scratch_database, monkeypatch):
    await _provision_to(scratch_database, "098")
    monkeypatch.setattr(resolution, "cache_get_or_set_locked", _uncached)
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            first = Organization(name="First", slug="first")
            second = Organization(name="Second", slug="second")
            session.add_all([first, second])
            await session.flush()
            rule = AgentRule(
                organization_id=first.id,
                source=RuleSource.ORGANIZATION,
                name="same_name",
                display_name="Pinned",
                content="Original body",
                latest_version_number=0,
            )
            session.add(rule)
            await session.flush()
            original = await stage_rule_version(session, rule, author_id=None)
            rule.active_version_pinned = True
            rule.content = "Edited body"
            await stage_rule_version(session, rule, author_id=None)
            await session.commit()
            result = await resolution.resolve_enabled_rules(
                session,
                organization_id=first.id,
                agent_id=generate_id(),
                enabled_rule_ids=[str(rule.id)],
            )
            assert result[0].version_id == original.id
            assert result[0].content == "Original body"
            with pytest.raises(ValidationError, match="unavailable"):
                await resolution.resolve_enabled_rules(
                    session,
                    organization_id=second.id,
                    agent_id=generate_id(),
                    enabled_rule_ids=[str(rule.id)],
                )
    finally:
        await engine.dispose()
