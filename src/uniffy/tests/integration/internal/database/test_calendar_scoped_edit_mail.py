"""Moving part of a series tells the people on it, against real rows."""

from datetime import UTC, date, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import delete, select, update

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.search import SearchIndexer
from uniffy.core.types import RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, read_event_mail
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

SERIES_START = datetime(2026, 3, 18, 9, tzinfo=UTC)
OCCURRENCE = date(2026, 3, 25)


async def _series(session, env) -> tuple[Calendar, CalendarEvent]:
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"scoped-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.commit()

    event = await CalendarEventOperations(session, MagicMock(spec=SearchIndexer)).create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        title="Standup",
        start_time=SERIES_START,
        end_time=SERIES_START + timedelta(minutes=30),
        calendar_id=calendar.id,
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1},
        attendee_ids=[env.member_id],
    )
    return calendar, event


async def _invitation_already_sent(session, env) -> None:
    """The scoped edit is what this asserts, so the invitation the creation
    staged is settled first rather than absorbing it."""
    await session.execute(
        update(NotificationEmailDelivery)
        .where(NotificationEmailDelivery.organization_id == env.org_id)
        .values(status=NotificationEmailStatus.SENT)
    )
    await session.commit()


async def _staged(session, env) -> list:
    rows = (
        (
            await session.execute(
                select(NotificationEmailDelivery).where(
                    NotificationEmailDelivery.composer == EmailComposer.CALENDAR.value,
                    NotificationEmailDelivery.user_id == env.member_id,
                    NotificationEmailDelivery.status == NotificationEmailStatus.PENDING,
                )
            )
        )
        .scalars()
        .all()
    )
    return [read_event_mail(row) for row in rows]


async def _clear(session, env, calendar_id) -> None:
    await session.rollback()
    await session.execute(
        delete(NotificationEmailDelivery).where(
            NotificationEmailDelivery.organization_id == env.org_id
        )
    )
    await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar_id))
    await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
    await session.commit()


async def test_moving_one_occurrence_tells_the_room(session, env) -> None:
    """A scoped edit used to settle silently: the occurrence moved and nobody
    on the meeting heard about it."""
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    before = event.ical_sequence
    await _invitation_already_sent(session, env)

    try:
        await ops.edit_single_occurrence(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )

        staged = await _staged(session, env)
        assert [request.kind for request in staged] == [CalendarMailKind.CHANGE]
        assert "schedule_changed" in staged[0].changes
        assert (await session.get(CalendarEvent, event_id)).ical_sequence == before + 1
    finally:
        await _clear(session, env, calendar_id)


async def test_splitting_a_series_tells_the_room_about_both_halves(session, env) -> None:
    """The series everybody holds now stops earlier, and the one taking over
    is a meeting they have never been sent."""
    calendar, event = await _series(session, env)
    calendar_id, event_id = calendar.id, event.id
    ops = CalendarEventOperations(session, MagicMock(spec=SearchIndexer))
    await _invitation_already_sent(session, env)

    try:
        await ops.edit_this_and_following(
            env.admin_id,
            env.org_id,
            event_id,
            OCCURRENCE,
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
        )

        kinds = {request.kind for request in await _staged(session, env)}
        assert kinds == {CalendarMailKind.CHANGE, CalendarMailKind.INVITATION}
    finally:
        await _clear(session, env, calendar_id)
