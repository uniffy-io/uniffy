"""Calendar reminder rolling behavior tests."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.shared import AttendeeStatus
from uniffy.core.types import AccessMode, RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.jobs.jobs import _process_due_reminders


def _daily_event(start_time: datetime, **overrides: object) -> CalendarEvent:
    defaults: dict = {
        "organization_id": generate_id(),
        "organizer_id": generate_id(),
        "calendar_id": generate_id(),
        "title": "Standup",
        "start_time": start_time,
        "end_time": start_time + timedelta(minutes=30),
        "timezone": "UTC",
        "access_mode": AccessMode.OWNER_ONLY,
        "recurrence_pattern": RecurrencePattern.DAILY,
        "recurrence_config": {"interval": 1},
    }
    defaults.update(overrides)
    return CalendarEvent(**defaults)


def _reminder(event: CalendarEvent, scheduled_at: datetime, minutes: int = 15) -> EventReminder:
    return EventReminder(
        event_id=event.id,
        user_id=generate_id(),
        minutes_before=minutes,
        scheduled_at=scheduled_at,
    )


def _session(rows: list, *, with_exceptions: bool, attendees: list | None = None) -> AsyncMock:
    session = AsyncMock()
    results = [SimpleNamespace(all=lambda: rows)]
    if with_exceptions:
        results.append(SimpleNamespace(all=list))
    resolved = attendees if attendees is not None else [None] * len(rows)
    results.extend(
        SimpleNamespace(scalar_one_or_none=lambda a=attendee: a) for attendee in resolved
    )
    session.execute.side_effect = results
    return session


async def test_fresh_recurring_reminder_emits_and_rolls_forward() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    target = base + timedelta(minutes=14)
    event = _daily_event(start_time=target - timedelta(days=3))
    reminder = _reminder(event, scheduled_at=target - timedelta(minutes=15))
    session = _session([(reminder, event)], with_exceptions=True)

    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        processed = await _process_due_reminders(session)

    assert processed == 1
    emit.assert_awaited_once()
    assert reminder.sent_at is None
    assert reminder.scheduled_at == target + timedelta(days=1) - timedelta(minutes=15)
    session.commit.assert_awaited_once()


async def test_stale_recurring_reminder_reanchors_without_emitting() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    stale_target = base - timedelta(days=2) + timedelta(minutes=45)
    event = _daily_event(start_time=stale_target - timedelta(days=10))
    reminder = _reminder(event, scheduled_at=stale_target - timedelta(minutes=15))
    session = _session([(reminder, event)], with_exceptions=True)

    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        await _process_due_reminders(session)

    emit.assert_not_awaited()
    assert reminder.sent_at is None
    assert reminder.scheduled_at == stale_target + timedelta(days=2) - timedelta(minutes=15)


async def test_ended_series_closes_the_row() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    event = _daily_event(
        start_time=base - timedelta(days=10),
        recurrence_config={
            "interval": 1,
            "end_date": (base - timedelta(days=2)).isoformat(),
        },
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(days=2))
    session = _session([(reminder, event)], with_exceptions=True)

    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        await _process_due_reminders(session)

    emit.assert_not_awaited()
    assert reminder.sent_at is not None


async def test_non_recurring_reminder_emits_once_and_closes() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    event = _daily_event(
        start_time=base + timedelta(minutes=30),
        recurrence_pattern=RecurrencePattern.NONE,
        recurrence_config=None,
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(minutes=1))
    session = _session([(reminder, event)], with_exceptions=False)

    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        await _process_due_reminders(session)

    emit.assert_awaited_once()
    assert reminder.sent_at is not None


async def _emitted_event(event: CalendarEvent, reminder: EventReminder) -> object:
    session = _session([(reminder, event)], with_exceptions=False)
    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        await _process_due_reminders(session)
    return emit.await_args.args[0]


async def test_reminder_has_no_actor_so_the_organizer_is_not_filtered_out() -> None:
    # The fan-out drops the actor from explicit targets, so naming the organizer
    # here silently discarded every organizer's reminder for their own event.
    base = datetime.now(UTC).replace(microsecond=0)
    event = _daily_event(
        start_time=base + timedelta(minutes=30),
        recurrence_pattern=RecurrencePattern.NONE,
        recurrence_config=None,
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(minutes=1))
    reminder.user_id = event.organizer_id

    emitted = await _emitted_event(event, reminder)

    assert emitted.actor_id is None
    assert emitted.target_user_ids == [event.organizer_id]


async def test_channel_bound_event_carries_the_channel_in_metadata() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    channel_id = generate_id()
    event = _daily_event(
        start_time=base + timedelta(minutes=30),
        recurrence_pattern=RecurrencePattern.NONE,
        recurrence_config=None,
        channel_id=channel_id,
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(minutes=1))

    emitted = await _emitted_event(event, reminder)

    assert emitted.metadata == {"channel_id": str(channel_id)}


async def test_unbound_event_carries_no_metadata() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    event = _daily_event(
        start_time=base + timedelta(minutes=30),
        recurrence_pattern=RecurrencePattern.NONE,
        recurrence_config=None,
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(minutes=1))

    emitted = await _emitted_event(event, reminder)

    assert emitted.metadata is None


async def test_declined_attendee_is_closed_without_emitting() -> None:
    base = datetime.now(UTC).replace(microsecond=0)
    event = _daily_event(
        start_time=base + timedelta(minutes=30),
        recurrence_pattern=RecurrencePattern.NONE,
        recurrence_config=None,
    )
    reminder = _reminder(event, scheduled_at=base - timedelta(minutes=1))
    declined = SimpleNamespace(status=AttendeeStatus.DECLINED)
    session = _session([(reminder, event)], with_exceptions=False, attendees=[declined])

    with patch("uniffy.domains.scheduling.calendar.jobs.jobs.emit_notification", AsyncMock()) as emit:
        await _process_due_reminders(session)

    emit.assert_not_awaited()
    assert reminder.sent_at is not None
