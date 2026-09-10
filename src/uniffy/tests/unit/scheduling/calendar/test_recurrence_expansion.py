"""Occurrence-date generation: equivalence with a brute-force walk of the series,
and the closed-form seek that keeps a request proportional to its window."""

import calendar as cal_mod
from datetime import date, timedelta

import pytest

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import (
    _DAY_OF_WEEK_TO_INT,
    _generate_occurrence_dates,
    _seek_daily,
    _seek_monthly,
    _seek_weekly,
    _seek_yearly,
)

MONDAY = DayOfWeek.MONDAY.value
WEDNESDAY = DayOfWeek.WEDNESDAY.value
FRIDAY = DayOfWeek.FRIDAY.value
SATURDAY = DayOfWeek.SATURDAY.value
ALL_DAYS = [day.value for day in DayOfWeek]


def _reference_dates(
    event_start_date: date,
    pattern: RecurrencePattern,
    interval: int,
    days_of_week: list[str] | None,
    day_of_month: int | None,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Deliberately brute-force oracle: walk the series from its first occurrence
    and collect what lands in the window. Slow by construction, which is the
    point - it owes nothing to the arithmetic the real expanders use.
    """
    allowed_weekdays: set[int] | None = None
    if pattern == RecurrencePattern.DAILY and days_of_week and len(days_of_week) < 7:
        allowed_weekdays = {_DAY_OF_WEEK_TO_INT[d] for d in days_of_week if d in _DAY_OF_WEEK_TO_INT}

    if pattern == RecurrencePattern.DAILY:
        results: list[date] = []
        count = 0
        current = event_start_date
        while current <= range_end:
            if end_date and current > end_date:
                break
            if max_occurrences and count >= max_occurrences:
                break
            if allowed_weekdays is None or current.weekday() in allowed_weekdays:
                if current >= range_start:
                    results.append(current)
                count += 1
            current += timedelta(days=interval)
        return results

    if pattern in (RecurrencePattern.WEEKLY, RecurrencePattern.BIWEEKLY):
        weeks = interval * 2 if pattern == RecurrencePattern.BIWEEKLY else interval
        if days_of_week:
            target_days = sorted(
                {_DAY_OF_WEEK_TO_INT.get(d, event_start_date.weekday()) for d in days_of_week}
            )
        else:
            target_days = [event_start_date.weekday()]
        results = []
        count = 0
        current_week = event_start_date - timedelta(days=event_start_date.weekday())
        while current_week <= range_end + timedelta(days=6):
            if end_date and current_week > end_date + timedelta(days=6):
                break
            for day_num in target_days:
                occ = current_week + timedelta(days=day_num)
                if occ < event_start_date:
                    continue
                if end_date and occ > end_date:
                    break
                if max_occurrences and count >= max_occurrences:
                    break
                if occ >= range_start and occ <= range_end:
                    results.append(occ)
                count += 1
            if max_occurrences and count >= max_occurrences:
                break
            current_week += timedelta(weeks=weeks)
        return results

    if pattern == RecurrencePattern.MONTHLY:
        target_day = day_of_month or event_start_date.day
        results = []
        count = 0
        year, month = event_start_date.year, event_start_date.month
        while True:
            occ = date(year, month, min(target_day, cal_mod.monthrange(year, month)[1]))
            if occ < event_start_date:
                month += interval
                if month > 12:
                    year += (month - 1) // 12
                    month = (month - 1) % 12 + 1
                continue
            if end_date and occ > end_date:
                break
            if max_occurrences and count >= max_occurrences:
                break
            if occ > range_end:
                break
            if occ >= range_start:
                results.append(occ)
            count += 1
            month += interval
            if month > 12:
                year += (month - 1) // 12
                month = (month - 1) % 12 + 1
        return results

    if pattern == RecurrencePattern.YEARLY:
        results = []
        count = 0
        year = event_start_date.year
        while True:
            max_day = cal_mod.monthrange(year, event_start_date.month)[1]
            occ = date(year, event_start_date.month, min(event_start_date.day, max_day))
            if occ < event_start_date:
                year += interval
                continue
            if end_date and occ > end_date:
                break
            if max_occurrences and count >= max_occurrences:
                break
            if occ > range_end:
                break
            if occ >= range_start:
                results.append(occ)
            count += 1
            year += interval
        return results

    return []


def _scenarios() -> list[tuple]:
    """Every combination worth walking: the window sits before, on, inside and
    long after the series start, with and without each truncation rule.
    """
    starts = [date(2019, 1, 7), date(2020, 2, 29), date(2021, 3, 31), date(2024, 12, 30)]
    windows = [
        (date(2018, 1, 1), date(2018, 1, 8)),
        (date(2019, 1, 1), date(2019, 1, 31)),
        (date(2021, 6, 14), date(2021, 6, 21)),
        (date(2026, 9, 7), date(2026, 9, 14)),
        (date(2026, 1, 1), date(2026, 12, 31)),
    ]
    day_sets = [None, [MONDAY], [MONDAY, WEDNESDAY, FRIDAY], [SATURDAY], ALL_DAYS]
    cases: list[tuple] = []

    for start in starts:
        for range_start, range_end in windows:
            for interval in (1, 2, 3, 7):
                for days in day_sets:
                    cases.append(
                        (RecurrencePattern.DAILY, start, interval, days, None, range_start, range_end)
                    )
                    cases.append(
                        (
                            RecurrencePattern.WEEKLY,
                            start,
                            interval,
                            days,
                            None,
                            range_start,
                            range_end,
                        )
                    )
                cases.append(
                    (
                        RecurrencePattern.BIWEEKLY,
                        start,
                        interval,
                        [MONDAY, FRIDAY],
                        None,
                        range_start,
                        range_end,
                    )
                )
                for day_of_month in (None, 1, 15, 31):
                    cases.append(
                        (
                            RecurrencePattern.MONTHLY,
                            start,
                            interval,
                            None,
                            day_of_month,
                            range_start,
                            range_end,
                        )
                    )
                cases.append(
                    (RecurrencePattern.YEARLY, start, interval, None, None, range_start, range_end)
                )
    return cases


@pytest.mark.parametrize(
    ("pattern", "start", "interval", "days", "day_of_month", "range_start", "range_end"),
    _scenarios(),
)
@pytest.mark.parametrize("max_occurrences", [None, 1, 5, 40])
@pytest.mark.parametrize("end_offset_days", [None, 0, 45, 900])
def test_generated_dates_match_a_brute_force_walk(
    pattern: RecurrencePattern,
    start: date,
    interval: int,
    days: list[str] | None,
    day_of_month: int | None,
    range_start: date,
    range_end: date,
    max_occurrences: int | None,
    end_offset_days: int | None,
) -> None:
    end_date = None if end_offset_days is None else start + timedelta(days=end_offset_days)
    args = {
        "event_start_date": start,
        "pattern": pattern,
        "interval": interval,
        "days_of_week": days,
        "day_of_month": day_of_month,
        "end_date": end_date,
        "max_occurrences": max_occurrences,
        "range_start": range_start,
        "range_end": range_end,
    }

    assert _generate_occurrence_dates(**args) == _reference_dates(**args)


def test_seek_lands_on_the_window_without_walking_a_decade_of_daily_occurrences() -> None:
    start = date(2010, 3, 1)
    range_start = date(2026, 9, 7)

    cursor, spent = _seek_daily(start, 1, None, range_start)

    assert cursor == range_start
    assert spent == (range_start - start).days


def test_seek_daily_counts_only_allowed_weekdays_towards_the_occurrence_cap() -> None:
    start = date(2026, 1, 5)  # a Monday
    range_start = date(2026, 3, 2)  # eight weeks later, also a Monday

    cursor, spent = _seek_daily(start, 1, {0, 2, 4}, range_start)

    assert cursor == range_start
    # Eight whole weeks of Mon/Wed/Fri precede the window.
    assert spent == 8 * 3


def test_seek_daily_with_a_weekly_multiple_interval_keeps_the_masters_weekday() -> None:
    start = date(2026, 1, 5)  # a Monday
    range_start = date(2026, 3, 2)

    on_weekday, spent = _seek_daily(start, 14, {0}, range_start)
    off_weekday, none_spent = _seek_daily(start, 14, {3}, range_start)

    assert on_weekday == range_start
    assert spent == 4
    # Stepping in whole weeks never reaches Thursday, so nothing has counted.
    assert off_weekday == range_start
    assert none_spent == 0


def test_seek_weekly_charges_the_first_partial_week_only_from_the_master() -> None:
    start = date(2026, 1, 7)  # a Wednesday
    week_start = start - timedelta(days=start.weekday())
    target_days = [0, 2, 4]  # Mon, Wed, Fri

    cursor, spent = _seek_weekly(week_start, start, 1, target_days, date(2026, 2, 2))

    assert cursor == date(2026, 2, 2)
    # The Monday before the master never happened: 2 in week one, 3 in each of
    # the three whole weeks that follow.
    assert spent == 2 + 3 * 3


def test_seek_monthly_counts_months_whose_target_day_was_clamped() -> None:
    start = date(2021, 3, 31)
    range_start = date(2026, 9, 1)

    (year, month), spent = _seek_monthly(start, 1, 31, range_start)

    assert (year, month) == (2026, 9)
    # 66 months separate the two, and every short month in between still spent
    # an occurrence on its clamped last day.
    assert spent == 66


def test_seek_monthly_does_not_count_the_master_month_it_never_reached() -> None:
    start = date(2021, 3, 31)
    range_start = date(2026, 9, 1)

    (year, month), spent = _seek_monthly(start, 1, 1, range_start)

    assert (year, month) == (2026, 9)
    # The 1st of March 2021 precedes the master, so the series really begins in
    # April: one fewer than the 66 months that separate them.
    assert spent == 65


def test_seek_yearly_lands_on_the_first_year_reaching_the_window() -> None:
    start = date(2020, 2, 29)
    range_start = date(2026, 1, 1)

    year, spent = _seek_yearly(start, 2, range_start)

    assert year == 2026
    assert spent == 3


def test_monthly_expansion_touches_a_bounded_number_of_months(monkeypatch) -> None:
    """A month-long window on a century-old series must not consult the calendar
    once per elapsed month.
    """
    calls = 0
    real_monthrange = cal_mod.monthrange

    def counting_monthrange(year: int, month: int) -> tuple[int, int]:
        nonlocal calls
        calls += 1
        return real_monthrange(year, month)

    monkeypatch.setattr(cal_mod, "monthrange", counting_monthrange)

    dates = _generate_occurrence_dates(
        event_start_date=date(1926, 1, 15),
        pattern=RecurrencePattern.MONTHLY,
        interval=1,
        days_of_week=None,
        day_of_month=15,
        end_date=None,
        max_occurrences=None,
        range_start=date(2026, 9, 1),
        range_end=date(2026, 9, 30),
    )

    assert dates == [date(2026, 9, 15)]
    # Seek plus the two months the loop inspects; the walk would have cost 1200.
    assert calls <= 8
