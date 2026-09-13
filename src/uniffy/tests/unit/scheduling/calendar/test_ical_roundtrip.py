"""Serialize then read back: what an event loses on a trip through iCalendar."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.shared import DayOfWeek
from uniffy.core.types import (
    AccessMode,
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.scheduling.calendar.ical.emit import EventExport, serialize_events
from uniffy.domains.scheduling.calendar.ical.parse import ParsedEvent, parse_calendar
from uniffy.domains.scheduling.calendar.recurrence import _generate_occurrence_dates

BERLIN = "Europe/Berlin"
TOKYO = "Asia/Tokyo"
WEDNESDAY = DayOfWeek.WEDNESDAY.value


def _event(**overrides) -> CalendarEvent:
    defaults = {
        "organization_id": generate_id(),
        "organizer_id": generate_id(),
        "calendar_id": generate_id(),
        "title": "Standup",
        "start_time": datetime(2026, 3, 18, 9, tzinfo=UTC),
        "end_time": datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
        "access_mode": AccessMode.OWNER_ONLY,
    }
    event = CalendarEvent(**{**defaults, **overrides})
    event.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    event.updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    return event


def _roundtrip(export: EventExport) -> ParsedEvent:
    parsed = parse_calendar(serialize_events([export]))
    assert parsed.skipped == ()
    assert len(parsed.events) == 1
    return parsed.events[0]


def _dates(
    start: date, pattern: RecurrencePattern, config: dict | None, horizon: date
) -> list[date]:
    if pattern == RecurrencePattern.NONE:
        return [start]
    settings = config or {}
    return _generate_occurrence_dates(
        event_start_date=start,
        pattern=pattern,
        interval=max(1, settings.get("interval", 1)),
        days_of_week=settings.get("days_of_week"),
        day_of_month=settings.get("day_of_month"),
        end_date=None,
        max_occurrences=settings.get("max_occurrences"),
        range_start=start,
        range_end=horizon,
    )


def _series_cases() -> list[tuple[str, RecurrencePattern, dict, str]]:
    return [
        ("weekly", RecurrencePattern.WEEKLY, {"interval": 1, "days_of_week": [WEDNESDAY]}, "UTC"),
        ("biweekly", RecurrencePattern.BIWEEKLY, {"interval": 1, "days_of_week": [WEDNESDAY]}, "UTC"),
        ("daily-interval", RecurrencePattern.DAILY, {"interval": 3}, "UTC"),
        ("monthly-plain", RecurrencePattern.MONTHLY, {"interval": 1, "day_of_month": 15}, "UTC"),
        ("monthly-clamped", RecurrencePattern.MONTHLY, {"interval": 1, "day_of_month": 30}, "UTC"),
        ("monthly-last", RecurrencePattern.MONTHLY, {"interval": 1, "day_of_month": 31}, "UTC"),
        ("yearly", RecurrencePattern.YEARLY, {"interval": 1}, "UTC"),
        ("counted", RecurrencePattern.DAILY, {"interval": 1, "max_occurrences": 12}, "UTC"),
        ("zoned-weekly", RecurrencePattern.WEEKLY, {"interval": 1, "days_of_week": [WEDNESDAY]}, BERLIN),
    ]


@pytest.mark.parametrize(("name", "pattern", "config", "timezone"), _series_cases())
def test_a_series_survives_the_trip(
    name: str, pattern: RecurrencePattern, config: dict, timezone: str
) -> None:
    """Equivalence is asserted on the occurrence dates, not the stored config:
    BIWEEKLY legitimately returns as weekly with a doubled interval.
    """
    start = datetime(2026, 1, 14, 9, tzinfo=UTC)
    event = _event(
        start_time=start,
        end_time=start + timedelta(minutes=30),
        timezone=timezone,
        recurrence_pattern=pattern,
        recurrence_config=config,
    )

    parsed = _roundtrip(EventExport(event=event))

    horizon = date(2027, 6, 30)
    assert _dates(
        parsed.start_time.date(), parsed.recurrence_pattern, parsed.recurrence_config, horizon
    ) == _dates(start.date(), pattern, config, horizon)


class TestScalarFields:
    def test_the_basics_come_back_unchanged(self) -> None:
        event = _event(
            title="Quarterly review",
            description="Bring the deck",
            location="Room 3",
            meeting_url="https://meet.example.com/abc",
        )

        parsed = _roundtrip(EventExport(event=event))

        assert parsed.title == "Quarterly review"
        assert parsed.description == "Bring the deck"
        assert parsed.location == "Room 3"
        assert parsed.meeting_url == "https://meet.example.com/abc"
        assert parsed.ical_uid.startswith(str(event.id))

    def test_instants_are_preserved_exactly(self) -> None:
        event = _event(timezone=TOKYO)

        parsed = _roundtrip(EventExport(event=event))

        assert parsed.start_time == event.start_time
        assert parsed.end_time == event.end_time

    def test_the_events_zone_is_preserved(self) -> None:
        """A recurring series expanded in the wrong zone drifts at every DST edge."""
        event = _event(timezone=BERLIN)

        assert _roundtrip(EventExport(event=event)).timezone == BERLIN

    @pytest.mark.parametrize(
        "status", [EventStatus.CONFIRMED, EventStatus.TENTATIVE, EventStatus.CANCELLED]
    )
    def test_status_survives(self, status: EventStatus) -> None:
        assert _roundtrip(EventExport(event=_event(status=status))).status is status

    def test_privacy_and_transparency_survive(self) -> None:
        event = _event(
            visibility=EventVisibility.PRIVATE,
            transparency=EventTransparency.TRANSPARENT,
        )

        parsed = _roundtrip(EventExport(event=event))

        assert parsed.visibility is EventVisibility.PRIVATE
        assert parsed.transparency is EventTransparency.TRANSPARENT


class TestAllDay:
    def test_an_all_day_event_stays_all_day_with_no_drift(self) -> None:
        """The acceptance criterion this is here for: no timezone drift."""
        event = _event(
            start_time=datetime(2026, 3, 18, tzinfo=UTC),
            end_time=datetime(2026, 3, 19, tzinfo=UTC),
            is_all_day=True,
            timezone=TOKYO,
        )

        parsed = _roundtrip(EventExport(event=event))

        assert parsed.is_all_day
        assert parsed.start_time.astimezone(event.start_time.tzinfo).date() == date(2026, 3, 18)

    def test_a_multi_day_all_day_event_keeps_its_span(self) -> None:
        event = _event(
            start_time=datetime(2026, 3, 18, tzinfo=UTC),
            end_time=datetime(2026, 3, 21, tzinfo=UTC),
            is_all_day=True,
        )

        parsed = _roundtrip(EventExport(event=event))

        assert (parsed.end_time - parsed.start_time) == timedelta(days=3)


class TestOccurrences:
    def test_cancelled_occurrences_survive(self) -> None:
        event = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )
        export = EventExport(event=event, cancelled_dates=[date(2026, 3, 25), date(2026, 4, 8)])

        parsed = _roundtrip(export)

        assert parsed.cancelled_dates == (date(2026, 3, 25), date(2026, 4, 8))

    def test_cancelled_occurrences_survive_in_a_zoned_series(self) -> None:
        """EXDATE is emitted as an instant here, so reading it back has to
        resolve in the event's own zone rather than UTC."""
        event = _event(
            start_time=datetime(2026, 3, 18, 23, 30, tzinfo=UTC),
            end_time=datetime(2026, 3, 19, tzinfo=UTC),
            timezone=TOKYO,
            recurrence_pattern=RecurrencePattern.DAILY,
            recurrence_config={"interval": 1},
        )
        # 23:30 UTC is already the next day in Tokyo, which is the local date
        # the expander keys occurrences off.
        local_day = event.start_time.astimezone(ZoneInfo(TOKYO)).date()
        cancelled = local_day + timedelta(days=3)

        parsed = _roundtrip(EventExport(event=event, cancelled_dates=[cancelled]))

        assert parsed.cancelled_dates == (cancelled,)

    def test_a_moved_occurrence_survives_as_an_override(self) -> None:
        master = _event(
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_config={"interval": 1, "days_of_week": [WEDNESDAY]},
        )
        moved = _event(
            title="Standup (moved)",
            start_time=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end_time=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
            recurrence_id=master.id,
        )

        parsed = _roundtrip(EventExport(event=master, overrides=[EventExport(event=moved)]))

        assert len(parsed.overrides) == 1
        override = parsed.overrides[0]
        assert override.original_date == date(2026, 3, 25)
        assert override.event.title == "Standup (moved)"
        assert override.event.start_time == moved.start_time
