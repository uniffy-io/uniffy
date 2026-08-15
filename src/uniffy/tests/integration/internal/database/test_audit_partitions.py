"""Append-only enforcement and partition routing on the real `audit_events`.

Both are PostgreSQL properties: a trigger that must fire on the parent and on
every partition it propagates to, and a RANGE partition key that must place a
row by its `created_at`. Mocks cannot observe either.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from uniffy.core.audit.partitions import ensure_audit_partitions, partition_name
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _insert(session, env, *, created_at: datetime) -> AuditEvent:
    event = AuditEvent(
        organization_id=env.org_id,
        actor_user_id=env.admin_id,
        action="test.partition_probe",
        created_at=created_at,
    )
    session.add(event)
    await session.commit()
    return event


async def _partition_of(session, event: AuditEvent) -> str:
    result = await session.execute(
        text(
            "SELECT tableoid::regclass::text FROM audit_events "
            "WHERE id = :id AND created_at = :created_at"
        ),
        {"id": event.id, "created_at": event.created_at},
    )
    return result.scalar_one()


async def test_row_lands_in_the_partition_for_its_month(session, env) -> None:
    event = await _insert(session, env, created_at=datetime.now(UTC))
    assert await _partition_of(session, event) == partition_name(
        event.created_at.date().replace(day=1)
    )


async def test_resource_type_round_trips_as_model_enum(session, env) -> None:
    event = AuditEvent(
        organization_id=env.org_id,
        actor_user_id=env.admin_id,
        action="test.resource_type_roundtrip",
        resource_type=AuditResourceType.ORGANIZATION,
    )
    session.add(event)
    await session.commit()
    session.expunge(event)

    loaded = (
        await session.execute(select(AuditEvent).where(AuditEvent.id == event.id))
    ).scalar_one()

    assert loaded.resource_type is AuditResourceType.ORGANIZATION


async def test_update_is_rejected(session, env) -> None:
    event = await _insert(session, env, created_at=datetime.now(UTC))

    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(
                update(AuditEvent).where(AuditEvent.id == event.id).values(action="tampered")
            )

    await session.refresh(event)
    assert event.action == "test.partition_probe"


async def test_delete_is_rejected(session, env) -> None:
    event = await _insert(session, env, created_at=datetime.now(UTC))

    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(delete(AuditEvent).where(AuditEvent.id == event.id))


async def test_delete_against_the_partition_directly_is_rejected(session, env) -> None:
    """The trigger must propagate; deleting from the child is the obvious way around it."""
    event = await _insert(session, env, created_at=datetime.now(UTC))
    child = await _partition_of(session, event)

    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(text(f"DELETE FROM {child} WHERE id = :id"), {"id": event.id})


async def test_maintenance_opt_out_allows_a_delete(session, env) -> None:
    event = await _insert(session, env, created_at=datetime.now(UTC))

    async with session.begin_nested():
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(delete(AuditEvent).where(AuditEvent.id == event.id))

    remaining = await session.execute(
        text("SELECT count(*) FROM audit_events WHERE id = :id"), {"id": event.id}
    )
    assert remaining.scalar_one() == 0


async def test_opt_out_does_not_leak_past_its_transaction(session, env) -> None:
    """``SET LOCAL`` is the point: the escape hatch dies with the transaction."""
    async with session.begin_nested():
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))

    event = await _insert(session, env, created_at=datetime.now(UTC))
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(delete(AuditEvent).where(AuditEvent.id == event.id))


async def test_ensure_partitions_is_idempotent(session) -> None:
    await ensure_audit_partitions(session)
    await session.commit()

    assert await ensure_audit_partitions(session) == []
    await session.commit()


async def test_unprovisioned_month_lands_in_default_then_drains(session, env) -> None:
    far = datetime(2031, 3, 15, tzinfo=UTC)
    name = partition_name(far.date().replace(day=1))

    event = await _insert(session, env, created_at=far)
    try:
        assert await _partition_of(session, event) == "audit_events_default"

        created = await ensure_audit_partitions(
            session, today=far.date().replace(day=1), months_ahead=0
        )
        await session.commit()

        assert created == [name]
        assert await _partition_of(session, event) == name
    finally:
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(delete(AuditEvent).where(AuditEvent.id == event.id))
        await session.execute(text(f"DROP TABLE IF EXISTS {name}"))
        await session.commit()
