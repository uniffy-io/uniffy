"""Occurrence-aware reminder anchoring.

The anchor is the next occurrence whose reminder instant is still in the
future; recurring rows roll to it instead of firing once and going silent.
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, RecurrencePattern, generate_id
from uniffy.domains.calendar.reminders import is_recurring_master, next_reminder_start

NOW = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)
SOFIA = ZoneInfo("Europe/Sofia")


def _event(**overrides: object) -> CalendarEvent:
    defaults: dict = {
        "organization_id": generate_id(),
        "organizer_id": generate_id(),
        "calendar_id": generate_id(),
        "title": "Weekly sync",
        "start_time": NOW + timedelta(days=1),
        "end_time": NOW + timedelta(days=1, hours=1),
        "timezone": "UTC",
        "access_mode": AccessMode.OWNER_ONLY,
    }
    defaults.update(overrides)
    return CalendarEvent(**defaults)


def _daily(**overrides: object) -> CalendarEvent:
    return _event(
        recurrence_pattern=RecurrencePattern.DAILY,
        recurrence_config={"interval": 1},
        **overrides,
    )


class TestNonRecurring:
    def test_future_event_anchors_to_its_start(self) -> None:
        event = _event()

        assert next_reminder_start(event, set(), 15, NOW) == event.start_time

    def test_event_inside_the_lead_window_has_no_anchor(self) -> None:
        event = _event(start_time=NOW + timedelta(minutes=10))

        assert next_reminder_start(event, set(), 15, NOW) is None

    def test_override_rows_do_not_expand(self) -> None:
        override = _daily(recurrence_id=generate_id(), start_time=NOW - timedelta(days=1))

        assert not is_recurring_master(override)
        assert next_reminder_start(override, set(), 15, NOW) is None


class TestRecurring:
    def test_first_occurrence_still_ahead_anchors_to_the_master_start(self) -> None:
        event = _daily()

        assert next_reminder_start(event, set(), 15, NOW) == event.start_time

    def test_past_first_occurrence_anchors_to_the_next_one(self) -> None:
        event = _daily(
            start_time=NOW - timedelta(days=3, hours=2),
            end_time=NOW - timedelta(days=3, hours=1),
        )

        anchor = next_reminder_start(event, set(), 15, NOW)

        assert anchor == NOW - timedelta(hours=2) + timedelta(days=1)

    def test_occurrence_inside_the_lead_window_is_skipped(self) -> None:
        # Daily at 13:00; at 12:50 a 15-minute reminder can only target tomorrow.
        start = datetime(2026, 8, 20, 13, 0, tzinfo=UTC)
        event = _daily(start_time=start, end_time=start + timedelta(hours=1))
        now = datetime(2026, 8, 24, 12, 50, tzinfo=UTC)

        anchor = next_reminder_start(event, set(), 15, now)

        assert anchor == datetime(2026, 8, 25, 13, 0, tzinfo=UTC)

    def test_cancelled_occurrence_is_skipped(self) -> None:
        event = _daily(
            start_time=NOW - timedelta(days=3, hours=2),
            end_time=NOW - timedelta(days=3, hours=1),
        )
        tomorrow = (NOW + timedelta(days=1)).date()

        anchor = next_reminder_start(event, {(NOW.date())}, 15, NOW)
        assert anchor is not None

        anchor = next_reminder_start(event, {NOW.date(), tomorrow}, 15, NOW)
        # Today's 10:00 occurrence already passed the lead check regardless;
        # cancelling today and tomorrow pushes the anchor two days out.
        assert anchor == NOW - timedelta(hours=2) + timedelta(days=2)

    def test_series_end_leaves_no_anchor(self) -> None:
        event = _event(
            start_time=NOW - timedelta(days=10, hours=2),
            end_time=NOW - timedelta(days=10, hours=1),
            recurrence_pattern=RecurrencePattern.DAILY,
            recurrence_config={"interval": 1, "end_date": (NOW - timedelta(days=2)).isoformat()},
        )

        assert next_reminder_start(event, set(), 15, NOW) is None

    def test_after_start_rolls_past_the_reminded_occurrence(self) -> None:
        event = _daily(
            start_time=NOW - timedelta(days=3),
            end_time=NOW - timedelta(days=3) + timedelta(hours=1),
        )
        target = NOW + timedelta(days=1)

        anchor = next_reminder_start(event, set(), 30, NOW, after_start=target)

        assert anchor == target + timedelta(days=1)

    def test_long_lead_reaches_past_the_expansion_window(self) -> None:
        # A two-week lead on a daily series: the anchor is the first
        # occurrence more than 14 days out.
        event = _daily(
            start_time=NOW - timedelta(days=30, hours=2),
            end_time=NOW - timedelta(days=30, hours=1),
        )
        lead_minutes = 14 * 24 * 60

        anchor = next_reminder_start(event, set(), lead_minutes, NOW)

        assert anchor is not None
        assert anchor - timedelta(minutes=lead_minutes) > NOW

    def test_anchor_preserves_the_local_wall_clock_across_dst(self) -> None:
        # Weekly 10:00 Sofia created in winter (08:00Z); the summer anchor
        # must stay 10:00 local, not 08:00Z.
        start = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        event = _event(
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="Europe/Sofia",
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1},
        )
        summer_now = datetime(2026, 7, 14, 12, 0, tzinfo=UTC)

        anchor = next_reminder_start(event, set(), 15, summer_now)

        assert anchor is not None
        assert anchor.astimezone(SOFIA).hour == 10

    def test_monthly_series_finds_the_next_month(self) -> None:
        start = datetime(2026, 1, 10, 9, 0, tzinfo=UTC)
        event = _event(
            start_time=start,
            end_time=start + timedelta(hours=1),
            recurrence_pattern=RecurrencePattern.MONTHLY,
            recurrence_config={"interval": 1},
        )

        anchor = next_reminder_start(event, set(), 15, NOW)

        assert anchor == datetime(2026, 9, 10, 9, 0, tzinfo=UTC)
