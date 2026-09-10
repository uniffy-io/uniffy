import pytest
from alembic import command
from alembic.config import Config
from psycopg2.errors import CheckViolation
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _execute,
    _migrate_to,
    _provision_to,
    _query,
)


async def test_evaluation_schema_preserves_skills_and_requires_scoped_targets(scratch_database):
    await _provision_to(scratch_database, "097")
    engine = create_async_engine(get_database_url())
    organization_id, owner_id = generate_id(), generate_id()
    try:
        async with AsyncSession(engine) as session:
            session.add_all([
                Organization(id=organization_id, name="Evaluations", slug="evaluations"),
                User(id=owner_id, username="builder", email="builder@example.test"),
            ])
            await session.flush()
            skill_id, version_id = generate_id(), generate_id()
            await session.execute(
                text(
                    "INSERT INTO agents_skills "
                    "(id, organization_id, name, display_name, source, content, "
                    "active_version_id, created_at) "
                    "VALUES (:id, :org, 'report', 'Report', 'organization', "
                    "'Existing instructions', :version, now())"
                ),
                {"id": skill_id, "org": organization_id, "version": version_id},
            )
            await session.execute(
                text(
                    "INSERT INTO agents_skill_versions "
                    "(id, skill_id, version_number, name, display_name, content) "
                    "VALUES (:id, :skill, 1, 'report', 'Report', 'Existing instructions')"
                ),
                {"id": version_id, "skill": skill_id},
            )
            await session.commit()
    finally:
        await engine.dispose()
    skill_before = _query("SELECT id, name, content, active_version_id FROM agents_skills")
    versions_before = _query(
        "SELECT id, skill_id, content, version_number FROM agents_skill_versions"
    )
    _migrate_to("098")
    assert _query("SELECT id, name, content, active_version_id FROM agents_skills") == skill_before
    assert (
        _query("SELECT id, skill_id, content, version_number FROM agents_skill_versions")
        == versions_before
    )
    assert _query("SELECT count(*) FROM agents_skill_evaluation_cases") == [(0,)]
    assert _query("SELECT count(*) FROM agents_skill_evaluation_runs") == [(0,)]
    for targets in ["NULL, NULL", f"'{generate_id()}', '{generate_id()}'"]:
        with pytest.raises(CheckViolation):
            _execute(
                "INSERT INTO agents_skill_evaluation_cases "
                "(id, organization_id, owner_id, skill_id, draft_id, fields, created_at, updated_at) "
                f"VALUES ('{generate_id()}', '{organization_id}', '{owner_id}', {targets}, '{{}}', now(), now())"
            )
        with pytest.raises(CheckViolation):
            _execute(
                "INSERT INTO agents_skill_evaluation_runs "
                "(id, organization_id, owner_id, request_id, request_digest, case_id, agent_id, "
                "skill_id, skill_version_id, draft_id, version_number, target_digest, snapshot, created_at, deadline_at) "
                f"VALUES ('{generate_id()}', '{organization_id}', '{owner_id}', '{generate_id()}', 'digest', "
                f"'{generate_id()}', '{generate_id()}', '{skill_before[0][0]}', {targets}, 1, 'digest', '{{}}', now(), now())"
            )
    indexes = {
        row[0]
        for row in _query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'agents_skill_evaluation_runs'"
        )
    }
    assert {
        "ix_skill_evaluation_runs_skill",
        "ix_skill_evaluation_runs_draft",
        "ix_skill_evaluation_runs_deadline",
        "ix_skill_evaluation_runs_open_org",
    } <= indexes
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "097")
    assert _query("SELECT id, name, content, active_version_id FROM agents_skills") == skill_before
    assert (
        _query("SELECT id, skill_id, content, version_number FROM agents_skill_versions")
        == versions_before
    )
    _migrate_to("098")
    assert _query("SELECT count(*) FROM agents_skill_evaluation_runs") == [(0,)]
