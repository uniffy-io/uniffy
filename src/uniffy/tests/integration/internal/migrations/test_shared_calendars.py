"""Existing calendars receive durable search work when sharing is introduced."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _insert_organization,
    _migrate_to,
    _provision_to,
    _query,
)


async def test_existing_calendars_are_queued_after_upgrade(scratch_database: str):
    await _provision_to(scratch_database, "111")
    engine = create_async_engine(get_database_url())
    calendar_id = generate_id()
    try:
        async with AsyncSession(engine) as session:
            org_id = await _insert_organization(
                session, name="Calendar migration", slug="calendar-migration"
            )
            user = User(username="calendar-owner", email="calendar-owner@example.test")
            session.add(user)
            await session.flush()
            await session.execute(
                text(
                    "INSERT INTO calendar_calendars (id, organization_id, owner_id, name, access_mode, created_at, updated_at) "
                    "VALUES (:id, :org, :owner, 'My calendar', NULL, now(), now())"
                ),
                {"id": calendar_id, "org": org_id, "owner": user.id},
            )
            await session.commit()
    finally:
        await engine.dispose()
    _migrate_to("112")
    queued = _query(
        "SELECT calendar_id, cardinality(pending_event_ids) FROM calendar_search_acl_refresh_queue"
    )
    assert len(queued) == 1
    assert str(queued[0][0]) == str(calendar_id)
    assert queued[0][1] == 0
    assert _query("SELECT access_mode FROM calendar_calendars") == [("OWNER_ONLY",)]
