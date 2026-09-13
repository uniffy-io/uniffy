"""What a bounded export or feed window has to carry, read from real rows."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.shared import DayOfWeek
from uniffy.core.types import AccessMode, RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader

pytestmark = pytest.mark.asyncio(loop_scope="session")

NOW = datetime(2026, 3, 18, 12, 0, tzinfo=UTC)
WINDOW_START = NOW - timedelta(days=90)
WINDOW_END = NOW + timedelta(days=365)


async def _calendar(session, env) -> Calendar:
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"window-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.flush()
    return calendar


def _event(env, calendar: Calendar, *, title: str, start: datetime, **overrides) -> CalendarEvent:
    return CalendarEvent(
        organization_id=env.org_id,
        organizer_id=env.admin_id,
        calendar_id=calendar.id,
        title=title,
        start_time=start,
        end_time=start + timedelta(minutes=30),
        access_mode=AccessMode.OWNER_ONLY,
        **overrides,
    )


async def _titles_in_window(session, env, calendar: Calendar) -> set[str]:
    events, _ = await CalendarEventReader(session).list_events_in_window(
        env.admin_id,
        env.org_id,
        calendar_id=calendar.id,
        start_date=WINDOW_START,
        end_date=WINDOW_END,
        limit=100,
    )
    return {event.title for event in events}


async def test_a_series_older_than_the_window_still_publishes(session, env) -> None:
    """A weekly meeting set up two years ago still happens this week, and the
    master carrying the rule is what an external client expands."""
    calendar = await _calendar(session, env)
    session.add_all([
        _event(
            env,
            calendar,
            title="Old standup",
            start=NOW - timedelta(days=730),
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        ),
        _event(env, calendar, title="Inside the window", start=NOW + timedelta(days=3)),
        _event(env, calendar, title="Far past one-off", start=NOW - timedelta(days=400)),
    ])
    await session.commit()

    try:
        assert await _titles_in_window(session, env, calendar) == {
            "Old standup",
            "Inside the window",
        }
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()


async def test_a_series_that_already_ran_out_is_left_behind(session, env) -> None:
    calendar = await _calendar(session, env)
    session.add(
        _event(
            env,
            calendar,
            title="Retired standup",
            start=NOW - timedelta(days=730),
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={
                "interval": 1,
                "days_of_week": [DayOfWeek.WEDNESDAY.value],
                "end_date": (NOW - timedelta(days=365)).isoformat(),
            },
        )
    )
    await session.commit()

    try:
        assert await _titles_in_window(session, env, calendar) == set()
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()


@pytest.mark.parametrize(
    "expired_config",
    [
        {"end_date": (NOW - timedelta(days=365)).isoformat()},
        {"max_occurrences": 3},
    ],
)
async def test_expired_series_do_not_spend_window_limit(session, env, expired_config) -> None:
    calendar = await _calendar(session, env)
    for number in range(2000):
        session.add(
            _event(
                env,
                calendar,
                title=f"Expired {number}",
                start=NOW - timedelta(days=730),
                recurrence_pattern=RecurrencePattern.WEEKLY,
                recurrence_config={"interval": 1, **expired_config},
            )
        )
    session.add(_event(env, calendar, title="Current", start=NOW))
    await session.commit()
    try:
        rows, total = await CalendarEventReader(session).list_events_in_window(
            env.admin_id,
            env.org_id,
            calendar_id=calendar.id,
            start_date=WINDOW_START,
            end_date=WINDOW_END,
            limit=2000,
        )
        assert [row.title for row in rows] == ["Current"]
        assert total == 1
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()


async def test_moved_override_keeps_its_expired_master_in_window(session, env) -> None:
    calendar = await _calendar(session, env)
    master = _event(
        env,
        calendar,
        title="Expired master",
        start=NOW - timedelta(days=730),
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1, "max_occurrences": 3},
    )
    session.add(master)
    await session.flush()
    session.add(_event(env, calendar, title="Moved", start=NOW, recurrence_id=master.id))
    await session.commit()
    try:
        assert await _titles_in_window(session, env, calendar) == {"Expired master"}
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()


async def test_last_multiday_occurrence_overlaps_after_end_date(session, env) -> None:
    calendar = await _calendar(session, env)
    master = _event(
        env,
        calendar,
        title="Long final occurrence",
        start=WINDOW_START - timedelta(days=9),
        recurrence_pattern=RecurrencePattern.WEEKLY,
        timezone="Pacific/Auckland",
        recurrence_config={"interval": 1, "max_occurrences": 2},
    )
    master.end_time = master.start_time + timedelta(days=3)
    session.add(master)
    await session.commit()
    try:
        assert await _titles_in_window(session, env, calendar) == {"Long final occurrence"}
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()


async def test_large_interval_outside_window_does_not_overflow(session, env) -> None:
    calendar = await _calendar(session, env)
    session.add(
        _event(
            env,
            calendar,
            title="Distant next occurrence",
            start=NOW - timedelta(days=730),
            recurrence_pattern=RecurrencePattern.MONTHLY,
            recurrence_config={"interval": 50000, "max_occurrences": 2},
        )
    )
    await session.commit()
    try:
        assert await _titles_in_window(session, env, calendar) == set()
    finally:
        await session.execute(delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar.id))
        await session.execute(delete(Calendar).where(Calendar.id == calendar.id))
        await session.commit()
