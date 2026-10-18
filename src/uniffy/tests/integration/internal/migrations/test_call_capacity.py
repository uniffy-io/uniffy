from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _migrate_to,
    _provision_to,
    _query,
)


async def test_capacity_upgrade_preserves_calls_and_snapshots_policy(scratch_database: str) -> None:
    await _provision_to(scratch_database, "112")
    engine = create_async_engine(get_database_url())
    expected = {}
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            user = User(username="caller", email="caller@example.test")
            session.add(user)
            await session.flush()
            for capacity in (None, 1, 75):
                org = Organization(name=f"Calls {capacity}", slug=f"calls-{capacity}")
                session.add(org)
                await session.flush()
                channel = ChatChannel(
                    organization_id=org.id,
                    owner_id=user.id,
                    name="Calls",
                    slug="calls",
                    channel_type=ChannelType.PUBLIC,
                )
                session.add(channel)
                if capacity is not None:
                    session.add(
                        OrgSetting(
                            organization_id=org.id,
                            namespace="calls",
                            key="policy",
                            value={"max_participants": capacity},
                        )
                    )
                await session.flush()
                call_id = generate_id()
                await session.execute(
                    text(
                        "INSERT INTO calls_calls "
                        "(id, organization_id, channel_id, call_type, initiator_user_id, "
                        "host_user_id, livekit_room_name, started_at, created_at) "
                        "VALUES (:id, :org, :channel, 'CHANNEL', :user, :user, :room, now(), now())"
                    ),
                    {
                        "id": call_id,
                        "org": org.id,
                        "channel": channel.id,
                        "user": user.id,
                        "room": str(call_id),
                    },
                )
                expected[str(call_id)] = capacity if capacity is not None else 50
            await session.commit()
    finally:
        await engine.dispose()

    _migrate_to("113")
    assert dict(_query("SELECT id::text, max_participants FROM calls_calls")) == expected

    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "112")
    assert _query("SELECT count(*) FROM calls_calls") == [(3,)]
    assert (
        _query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'calls_calls' AND column_name = 'max_participants'"
        )
        == []
    )
    _migrate_to("113")
    assert dict(_query("SELECT id::text, max_participants FROM calls_calls")) == expected
