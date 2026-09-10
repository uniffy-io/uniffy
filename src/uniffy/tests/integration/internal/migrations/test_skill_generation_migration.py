from alembic import command
from alembic.config import Config
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


async def test_generation_upgrade_preserves_drafts_and_downgrade_settles_open_attempts(
    scratch_database,
):
    await _provision_to(scratch_database, "097")
    org_id, user_id, draft_id = generate_id(), generate_id(), generate_id()
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine) as session:
            session.add_all([
                Organization(id=org_id, name="Drafts", slug="drafts"),
                User(id=user_id, username="builder", email="builder@example.test"),
            ])
            await session.commit()
    finally:
        await engine.dispose()
    _execute(
        "INSERT INTO agents_skill_drafts "
        "(id, organization_id, owner_id, kind, name, display_name, content) "
        f"VALUES ('{draft_id}', '{org_id}', '{user_id}', 'create', 'report', 'Report', 'BODY')"
    )
    before = _query("SELECT id, name, content, status, is_deleted FROM agents_skill_drafts")
    _migrate_to("098")
    assert _query("SELECT id, name, content, status, is_deleted FROM agents_skill_drafts") == before
    assert _query("SELECT generation_attempt, invocation_id FROM agents_skill_drafts") == [(0, None)]
    assert _query(
        "SELECT character_maximum_length FROM information_schema.columns "
        "WHERE table_name = 'agents_skill_drafts' AND column_name = 'status'"
    ) == [(32,)]
    for status in ("generating", "generation_failed"):
        _execute(
            "INSERT INTO agents_skill_drafts "
            "(id, organization_id, owner_id, kind, status, generation_attempt) "
            f"VALUES ('{generate_id()}', '{org_id}', '{user_id}', 'create', '{status}', 1)"
        )
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "097")
    assert (
        _query(
            "SELECT id, name, content, status, is_deleted FROM agents_skill_drafts "
            f"WHERE id = '{draft_id}'"
        )
        == before
    )
    assert _query(
        f"SELECT status, is_deleted FROM agents_skill_drafts WHERE id <> '{draft_id}'"
    ) == [("discarded", True), ("discarded", True)]
    assert (
        _query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'agents_skill_drafts' "
            "AND column_name = 'generation_attempt'"
        )
        == []
    )
