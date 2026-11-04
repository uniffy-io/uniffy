from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _execute,
    _insert_organization,
    _migrate_to,
    _provision_to,
    _query,
    _run_alembic,
)


async def test_generation_upgrade_preserves_drafts_and_downgrade_settles_open_attempts(
    scratch_database,
):
    await _provision_to(scratch_database, "097")
    user_id, draft_id = generate_id(), generate_id()
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine) as session:
            org_id = await _insert_organization(session, name="Drafts", slug="drafts")
            session.add(User(id=user_id, username="builder", email="builder@example.test"))
            await session.commit()
    finally:
        await engine.dispose()
    await _execute(
        "INSERT INTO agents_skill_drafts "
        "(id, organization_id, owner_id, kind, name, display_name, content) "
        f"VALUES ('{draft_id}', '{org_id}', '{user_id}', 'create', 'report', 'Report', 'BODY')"
    )
    before = await _query("SELECT id, name, content, status, is_deleted FROM agents_skill_drafts")
    await _migrate_to("098")
    assert (
        await _query("SELECT id, name, content, status, is_deleted FROM agents_skill_drafts")
    ) == before
    assert (await _query("SELECT generation_attempt, invocation_id FROM agents_skill_drafts")) == [
        (0, None)
    ]
    assert (
        await _query(
            "SELECT character_maximum_length FROM information_schema.columns "
            "WHERE table_name = 'agents_skill_drafts' AND column_name = 'status'"
        )
    ) == [(32,)]
    for status in ("generating", "generation_failed"):
        await _execute(
            "INSERT INTO agents_skill_drafts "
            "(id, organization_id, owner_id, kind, status, generation_attempt) "
            f"VALUES ('{generate_id()}', '{org_id}', '{user_id}', 'create', '{status}', 1)"
        )
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.downgrade, "097")
    assert (
        await _query(
            "SELECT id, name, content, status, is_deleted FROM agents_skill_drafts "
            f"WHERE id = '{draft_id}'"
        )
    ) == before
    assert (
        await _query(f"SELECT status, is_deleted FROM agents_skill_drafts WHERE id <> '{draft_id}'")
    ) == [("discarded", True), ("discarded", True)]
    assert (
        await _query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'agents_skill_drafts' "
            "AND column_name = 'generation_attempt'"
        )
    ) == []
