"""Wall-clock preservation, range clipping, and series-end interpretation for
recurrence expansion."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from uniffy.core.models.shared import RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import (
    count_occurrences_through,
    expand_recurrence,
    occurrence_start_for_date,
    recurrence_end_date,
    series_end_bound,
)

SOFIA = ZoneInfo("Europe/Sofia")
KARACHI = ZoneInfo("Asia/Karachi")


def test_occurrence_start_preserves_local_wall_clock_across_dst() -> None:
    # Winter series: 10:00 EET (+2) == 08:00Z.
    winter_start = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)

    summer_occ = occurrence_start_for_date(winter_start, "Europe/Sofia", date(2026, 7, 16))

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

    assert [o.start_time for o in occurrences] == [datetime(2026, 7, 9, 3, 0, tzinfo=UTC)]
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


def test_end_bound_instant_resolves_in_the_event_zone() -> None:
    # A user east of UTC picks "ends 2026-03-09"; the client transmits local
    # midnight, an instant on the PREVIOUS UTC date. Reading the UTC date
    # would end the series a day early.
    picked = datetime(2026, 3, 9, 0, 0, tzinfo=KARACHI)
    config = {"end_date": picked.astimezone(UTC).isoformat()}

    assert recurrence_end_date(config, "Asia/Karachi") == date(2026, 3, 9)


def test_end_bound_date_only_and_naive_values_are_verbatim() -> None:
    assert recurrence_end_date({"end_date": "2026-03-09"}, "America/Los_Angeles") == date(
        2026, 3, 9
    )
    assert recurrence_end_date({"end_date": date(2026, 3, 9)}, "Asia/Karachi") == date(2026, 3, 9)
    assert recurrence_end_date({}, "UTC") is None


def test_series_end_bound_round_trips_to_the_day_before_the_cut() -> None:
    for zone in ("UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland"):
        bound = series_end_bound(date(2026, 3, 10), zone)

        assert recurrence_end_date({"end_date": bound}, zone) == date(2026, 3, 9)


def test_split_cut_excludes_the_chosen_day_for_late_evening_events() -> None:
    # Daily 23:00 Asia/Karachi; the series is cut at 2026-03-10. The chosen
    # occurrence and everything after must leave the old series exactly.
    start = datetime(2026, 3, 1, 23, 0, tzinfo=KARACHI).astimezone(UTC)

    occurrences = expand_recurrence(
        start_time=start,
        end_time=start + timedelta(hours=1),
        recurrence_pattern=RecurrencePattern.DAILY,
        recurrence_config={
            "interval": 1,
            "end_date": series_end_bound(date(2026, 3, 10), "Asia/Karachi"),
        },
        range_start=datetime(2026, 3, 1, tzinfo=UTC),
        range_end=datetime(2026, 3, 20, tzinfo=UTC),
        timezone="Asia/Karachi",
    )
    dates = [o.occurrence_date for o in occurrences]

    assert max(dates) == date(2026, 3, 9)
    assert date(2026, 3, 10) not in dates


def test_count_occurrences_through_includes_the_master_day() -> None:
    assert (
        count_occurrences_through(
            date(2026, 3, 1), RecurrencePattern.DAILY, {"interval": 1}, date(2026, 3, 9)
        )
        == 9
    )
    assert (
        count_occurrences_through(
            date(2026, 3, 2), RecurrencePattern.WEEKLY, {"interval": 1}, date(2026, 3, 16)
        )
        == 3
    )


def test_count_occurrences_through_respects_the_max_budget() -> None:
    assert (
        count_occurrences_through(
            date(2026, 3, 1),
            RecurrencePattern.DAILY,
            {"interval": 1, "max_occurrences": 5},
            date(2026, 3, 31),
        )
        == 5
    )
