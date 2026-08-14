"""Wall-clock preservation and range clipping for recurrence expansion."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from uniffy.core.models.shared import RecurrencePattern
from uniffy.domains.calendar.recurrence import (
    expand_recurrence,
    occurrence_start_for_date,
)

SOFIA = ZoneInfo("Europe/Sofia")


def test_occurrence_start_preserves_local_wall_clock_across_dst() -> None:
    # Winter series: 10:00 EET (+2) == 08:00Z.
    winter_start = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)

    summer_occ = occurrence_start_for_date(
        winter_start, "Europe/Sofia", date(2026, 7, 16)
    )

    assert summer_occ.astimezone(SOFIA).hour == 10
    assert summer_occ == datetime(2026, 7, 16, 7, 0, tzinfo=UTC)


def test_occurrence_start_invalid_zone_degrades_to_utc() -> None:
    start = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)

    occ = occurrence_start_for_date(start, "Not/AZone", date(2026, 7, 16))

    assert occ == datetime(2026, 7, 16, 8, 0, tzinfo=UTC)


def test_expander_matches_occurrence_helper_across_dst() -> None:
    winter_start = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)

    occurrences = expand_recurrence(
        start_time=winter_start,
        end_time=winter_start + timedelta(hours=1),
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1},
        range_start=datetime(2026, 7, 13, tzinfo=UTC),
        range_end=datetime(2026, 7, 20, tzinfo=UTC),
        timezone="Europe/Sofia",
    )

    assert len(occurrences) == 1
    occ = occurrences[0]
    assert occ.start_time == occurrence_start_for_date(
        winter_start, "Europe/Sofia", occ.occurrence_date
    )
    assert occ.start_time.astimezone(SOFIA).hour == 10


def test_boundary_occurrence_on_neighbouring_local_date_is_returned() -> None:
    # Weekly 20:00 America/Los_Angeles (PDT, -7): each occurrence's instant is
    # 03:00Z on the NEXT UTC day, so its local date precedes the UTC window
    # that contains it. 2026-07-02T03:00Z == 2026-07-01 20:00 PDT.
    start = datetime(2026, 7, 2, 3, 0, tzinfo=UTC)
    occurrences = expand_recurrence(
        start_time=start,
        end_time=start + timedelta(hours=1),
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1},
        range_start=datetime(2026, 7, 9, 0, 0, tzinfo=UTC),
        range_end=datetime(2026, 7, 9, 12, 0, tzinfo=UTC),
        timezone="America/Los_Angeles",
    )

    assert [o.start_time for o in occurrences] == [
        datetime(2026, 7, 9, 3, 0, tzinfo=UTC)
    ]
    assert occurrences[0].occurrence_date == date(2026, 7, 8)


def test_occurrence_outside_instant_window_is_clipped() -> None:
    start = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)

    occurrences = expand_recurrence(
        start_time=start,
        end_time=start + timedelta(hours=1),
        recurrence_pattern=RecurrencePattern.DAILY,
        recurrence_config={"interval": 1},
        range_start=datetime(2026, 7, 10, 0, 0, tzinfo=UTC),
        range_end=datetime(2026, 7, 11, 0, 0, tzinfo=UTC),
        timezone="UTC",
    )

    assert [o.occurrence_date for o in occurrences] == [date(2026, 7, 10)]
