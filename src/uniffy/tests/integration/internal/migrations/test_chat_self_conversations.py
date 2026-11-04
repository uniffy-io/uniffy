import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.login.user import User
from uniffy.infrastructure.database.session import (
    ALEMBIC_INI_PATH,
    get_database_url,
)
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _execute,
    _insert_chat_channel,
    _insert_organization,
    _migrate_to,
    _provision_to,
    _query,
    _run_alembic,
)


async def _insert_self_dm(org_id, owner_id, slug: str, *, deleted: bool = False) -> None:
    await _execute(
        "INSERT INTO chat_channels (id, organization_id, owner_id, name, slug, "
        "description, channel_type, is_archived, is_default, is_deleted, icon, "
        "is_agent_dm, is_self_dm, created_at, updated_at) VALUES (gen_random_uuid(), "
        "$1, $2, 'Me', $3, '', 'DIRECT', false, false, $4, '', false, true, now(), now())",
        org_id,
        owner_id,
        slug,
        deleted,
    )


async def test_self_conversation_flag_defaults_existing_rows_and_enforces_one_live_row(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "113")
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            owner = User(username="owner", email="owner@example.test")
            session.add(owner)
            org_id = await _insert_organization(session, name="Self", slug="self")
            await session.flush()
            await _insert_chat_channel(
                session,
                organization_id=org_id,
                owner_id=owner.id,
                name="Existing",
                channel_type=ChannelType.DIRECT,
            )
            await session.commit()
    finally:
        await engine.dispose()

    await _migrate_to("114")
    assert (await _query("SELECT name, is_self_dm FROM chat_channels")) == [("Existing", False)]

    await _insert_self_dm(org_id, owner.id, "me-live")
    with pytest.raises(asyncpg.UniqueViolationError):
        await _insert_self_dm(org_id, owner.id, "me-second")
    # A soft-deleted self conversation frees the slot for a fresh one.
    await _insert_self_dm(org_id, owner.id, "me-retired", deleted=True)
    assert (await _query("SELECT count(*) FROM chat_channels WHERE is_self_dm")) == [(2,)]

    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.downgrade, "113")
    assert (
        await _query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'chat_channels' AND column_name = 'is_self_dm'"
        )
    ) == []
    assert (
        await _query("SELECT indexname FROM pg_indexes WHERE indexname = 'uq_chat_channels_self_dm'")
    ) == []
