"""Two-way mapping between the in-house recurrence vocabulary and RFC 5545 RRULE."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from icalendar.prop import vRecur

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import (
    count_occurrences_through,
    recurrence_end_date,
    resolve_event_zone,
)

_DAY_TO_ICAL: dict[str, str] = {
    DayOfWeek.MONDAY.value: "MO",
    DayOfWeek.TUESDAY.value: "TU",
    DayOfWeek.WEDNESDAY.value: "WE",
    DayOfWeek.THURSDAY.value: "TH",
    DayOfWeek.FRIDAY.value: "FR",
    DayOfWeek.SATURDAY.value: "SA",
    DayOfWeek.SUNDAY.value: "SU",
}
_ICAL_TO_DAY = {abbrev: day for day, abbrev in _DAY_TO_ICAL.items()}
_WEEKDAY_ABBREVS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")

# The expander anchors every week to Monday, so an interval above one has to
# state the week start or a client defaulting to Sunday computes other weeks.
_WEEK_START = "MO"

# Days whose month overflow the expander pulls back to the last of the month
# instead of skipping. RFC 5545 skips, so these need the BYSETPOS form below.
_CLAMPED_DAYS = frozenset({29, 30})
_LAST_DAY_OF_MONTH = 31

_FREQ_DAILY = "DAILY"
_FREQ_WEEKLY = "WEEKLY"
_FREQ_MONTHLY = "MONTHLY"
_FREQ_YEARLY = "YEARLY"
_SUPPORTED_FREQUENCIES = frozenset({_FREQ_DAILY, _FREQ_WEEKLY, _FREQ_MONTHLY, _FREQ_YEARLY})
_UNSUPPORTED_PARTS = frozenset({
    "BYWEEKNO",
    "BYYEARDAY",
    "BYHOUR",
    "BYMINUTE",
    "BYSECOND",
})

# The one start date whose day is missing from some years.
_LEAP_DAY = (2, 29)


class RecurrenceRejection(StrEnum):
    """Why an inbound rule has no representation in the in-house vocabulary."""

    MISSING_FREQUENCY = "MISSING_FREQUENCY"
    UNSUPPORTED_FREQUENCY = "UNSUPPORTED_FREQUENCY"
    COUNT_AND_UNTIL = "COUNT_AND_UNTIL"
    MONTHLY_BY_WEEKDAY = "MONTHLY_BY_WEEKDAY"
    ORDINAL_WEEKDAY = "ORDINAL_WEEKDAY"
    MULTIPLE_MONTH_DAYS = "MULTIPLE_MONTH_DAYS"
    UNSUPPORTED_MONTH_DAY = "UNSUPPORTED_MONTH_DAY"
    CLAMPED_MONTH_DAY = "CLAMPED_MONTH_DAY"
    WEEK_START = "WEEK_START"
    UNSUPPORTED_PART = "UNSUPPORTED_PART"
    MALFORMED = "MALFORMED"


_REJECTION_MESSAGES: dict[RecurrenceRejection, str] = {
    RecurrenceRejection.MISSING_FREQUENCY: "The repeat rule states no frequency.",
    RecurrenceRejection.UNSUPPORTED_FREQUENCY: (
        "Only daily, weekly, monthly and yearly repeats are supported."
    ),
    RecurrenceRejection.COUNT_AND_UNTIL: (
        "The repeat rule sets both an end date and an occurrence count."
    ),
    RecurrenceRejection.MONTHLY_BY_WEEKDAY: (
        "Monthly repeats on a weekday position, such as the third Tuesday, are not supported."
    ),
    RecurrenceRejection.ORDINAL_WEEKDAY: (
        "Repeats on a numbered weekday, such as the second Monday, are not supported."
    ),
    RecurrenceRejection.MULTIPLE_MONTH_DAYS: "A monthly repeat may target only one day.",
    RecurrenceRejection.UNSUPPORTED_MONTH_DAY: (
        "A monthly repeat can count backwards only from the last day of the month."
    ),
    RecurrenceRejection.CLAMPED_MONTH_DAY: (
        "A monthly repeat on a day some months do not have would land on other dates here."
    ),
    RecurrenceRejection.WEEK_START: (
        "A repeat that counts its weeks from a day other than Monday is not supported."
    ),
    RecurrenceRejection.UNSUPPORTED_PART: ("The repeat rule uses options with no equivalent here."),
    RecurrenceRejection.MALFORMED: "The repeat rule could not be read.",
}


@dataclass(frozen=True)
class RecurrenceMapping:
    """An inbound rule expressed in the in-house vocabulary."""

    pattern: RecurrencePattern
    config: dict[str, Any]


@dataclass(frozen=True)
class UnsupportedRule:
    """An inbound rule that would have to be approximated, so it is refused."""

    rejection: RecurrenceRejection

    @property
    def message(self) -> str:
        return _REJECTION_MESSAGES[self.rejection]


def config_to_rrule(
    *,
    pattern: RecurrencePattern,
    config: dict[str, Any] | None,
    timezone: str,
    start_date: date,
) -> str | None:
    """Render the RRULE value for a series, or None when it does not repeat."""
    if pattern == RecurrencePattern.NONE or not config:
        return None

    interval = max(1, config.get("interval", 1))
    parts: list[str] = []

    if pattern == RecurrencePattern.DAILY:
        parts.append("FREQ=DAILY")
        _append_interval(parts, interval)
        days = _ical_days(config.get("days_of_week"))
        if days:
            parts.append(f"BYDAY={','.join(days)}")
    elif pattern in (RecurrencePattern.WEEKLY, RecurrencePattern.BIWEEKLY):
        # BIWEEKLY is expanded as weekly with a doubled interval; emitting the
        # stored interval verbatim would halve the series in every client.
        weeks = interval * 2 if pattern == RecurrencePattern.BIWEEKLY else interval
        parts.append("FREQ=WEEKLY")
        _append_interval(parts, weeks)
        days = _ical_days(config.get("days_of_week")) or [_WEEKDAY_ABBREVS[start_date.weekday()]]
        parts.append(f"BYDAY={','.join(days)}")
        if weeks > 1:
            parts.append(f"WKST={_WEEK_START}")
    elif pattern == RecurrencePattern.MONTHLY:
        parts.append("FREQ=MONTHLY")
        _append_interval(parts, interval)
        parts.extend(_monthly_parts(config.get("day_of_month") or start_date.day))
    elif pattern == RecurrencePattern.YEARLY:
        parts.append("FREQ=YEARLY")
        _append_interval(parts, interval)
        parts.extend(_yearly_parts(start_date))
    else:
        return None

    parts.extend(_bound_parts(pattern, config, timezone, start_date))
    return ";".join(parts)


def rrule_to_config(rrule: str, *, dtstart: date) -> RecurrenceMapping | UnsupportedRule:
    """Read an inbound RRULE, refusing anything the vocabulary cannot express."""
    try:
        parsed = vRecur.from_ical(rrule)
    except ValueError, TypeError:
        return UnsupportedRule(RecurrenceRejection.MALFORMED)

    parts = {str(key).upper(): value for key, value in parsed.items()}

    frequency = _single(parts.get("FREQ"))
    if frequency is None:
        return UnsupportedRule(RecurrenceRejection.MISSING_FREQUENCY)
    frequency = str(frequency).upper()
    if frequency not in _SUPPORTED_FREQUENCIES:
        return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_FREQUENCY)

    if parts.get("COUNT") and parts.get("UNTIL"):
        return UnsupportedRule(RecurrenceRejection.COUNT_AND_UNTIL)
    if any(part in parts for part in _UNSUPPORTED_PARTS):
        return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)

    config: dict[str, Any] = {"interval": max(1, int(_single(parts.get("INTERVAL")) or 1))}

    if frequency in (_FREQ_DAILY, _FREQ_WEEKLY):
        days = _weekday_names(parts.get("BYDAY"))
        if isinstance(days, UnsupportedRule):
            return days
        if parts.get("BYMONTHDAY") or parts.get("BYSETPOS") or parts.get("BYMONTH"):
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
        if _counts_weeks_elsewhere(frequency, config["interval"], _single(parts.get("WKST"))):
            return UnsupportedRule(RecurrenceRejection.WEEK_START)
        if days:
            config["days_of_week"] = days
        pattern = RecurrencePattern(frequency)
    elif frequency == _FREQ_MONTHLY:
        if parts.get("BYDAY"):
            return UnsupportedRule(RecurrenceRejection.MONTHLY_BY_WEEKDAY)
        if parts.get("BYMONTH"):
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
        day = _monthly_day(parts.get("BYMONTHDAY"), parts.get("BYSETPOS"), dtstart)
        if isinstance(day, UnsupportedRule):
            return day
        config["day_of_month"] = day
        pattern = RecurrencePattern.MONTHLY
    else:
        refusal = _yearly_refusal(parts, dtstart)
        if refusal is not None:
            return refusal
        pattern = RecurrencePattern.YEARLY

    count = _single(parts.get("COUNT"))
    if count:
        config["max_occurrences"] = int(count)
    until = _single(parts.get("UNTIL"))
    if until is not None:
        config["end_date"] = _until_to_config(until)

    return RecurrenceMapping(pattern=pattern, config=config)


def _append_interval(parts: list[str], interval: int) -> None:
    if interval > 1:
        parts.append(f"INTERVAL={interval}")


def _ical_days(days_of_week: list[str] | None) -> list[str]:
    if not days_of_week:
        return []
    abbrevs = [_DAY_TO_ICAL[day] for day in days_of_week if day in _DAY_TO_ICAL]
    return sorted(set(abbrevs), key=_WEEKDAY_ABBREVS.index)


def _monthly_parts(target_day: int) -> list[str]:
    """Express the expander's clamping, which RFC 5545 does not share.

    A plain ``BYMONTHDAY=30`` skips February outright, where the expander pulls
    the occurrence back to the 28th. Pairing the day with the month's last day
    and taking the first of the set reproduces the clamp exactly: in a long
    month the set is {30, 31} and the 30th wins, in February it collapses to
    the last day.
    """
    if target_day >= _LAST_DAY_OF_MONTH:
        return ["BYMONTHDAY=-1"]
    if target_day in _CLAMPED_DAYS:
        return [f"BYMONTHDAY={target_day},-1", "BYSETPOS=1"]
    return [f"BYMONTHDAY={target_day}"]


def _yearly_parts(start_date: date) -> list[str]:
    """February 29 is the only start date whose day is absent from some years.

    RFC 5545 would recur it in leap years alone, where the expander clamps it to
    the 28th - the same pairing the monthly case needs, scoped to February.
    """
    if (start_date.month, start_date.day) != _LEAP_DAY:
        return []
    return ["BYMONTH=2", "BYMONTHDAY=29,-1", "BYSETPOS=1"]


def _yearly_refusal(parts: dict[str, Any], dtstart: date) -> UnsupportedRule | None:
    """A yearly series repeats on its own month and day, so the BY parts are
    accepted only where they restate that rather than move it.
    """
    if parts.get("BYDAY"):
        return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)

    by_month = parts.get("BYMONTH")
    if by_month and {int(v) for v in _as_list(by_month)} != {dtstart.month}:
        return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)

    by_month_day = parts.get("BYMONTHDAY")
    if by_month_day:
        values = {int(v) for v in _as_list(by_month_day)}
        if values not in ({dtstart.day}, {-1}, {dtstart.day, -1}):
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)

    by_set_pos = parts.get("BYSETPOS")
    if by_set_pos and int(_single(by_set_pos)) != 1:
        return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
    return None


def _bound_parts(
    pattern: RecurrencePattern,
    config: dict[str, Any],
    timezone: str,
    start_date: date,
) -> list[str]:
    """Render the series bound; RFC 5545 forbids carrying COUNT and UNTIL together."""
    end = recurrence_end_date(config, timezone)
    max_occurrences = config.get("max_occurrences")

    if max_occurrences and end:
        # Both bounds set: the series really ends at whichever binds first, so
        # resolve it to the occurrence count the expander itself would reach.
        through = count_occurrences_through(start_date, pattern, config, end)
        return [f"COUNT={max(1, through)}"]
    if max_occurrences:
        return [f"COUNT={int(max_occurrences)}"]
    if end:
        return [f"UNTIL={_until_value(end, timezone)}"]
    return []


def _until_value(end: date, timezone: str) -> str:
    """The last instant of the local end day, in UTC as RFC 5545 requires."""
    tz = resolve_event_zone(timezone)
    local_end = datetime(end.year, end.month, end.day, tzinfo=tz) + timedelta(
        hours=23, minutes=59, seconds=59
    )
    return local_end.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")


def _until_to_config(until: Any) -> str:
    if isinstance(until, datetime):
        return until.isoformat()
    if isinstance(until, date):
        return datetime(until.year, until.month, until.day, tzinfo=ZoneInfo("UTC")).isoformat()
    return str(until)


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else [value]


def _single(value: Any) -> Any:
    """vRecur hands every part back as a list; these parts carry one value."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _weekday_names(by_day: Any) -> list[str] | UnsupportedRule:
    if not by_day:
        return []
    values = by_day if isinstance(by_day, list) else [by_day]
    names: list[str] = []
    for raw in values:
        token = str(raw).upper().strip()
        if token[:-2].strip("+-").isdigit():
            return UnsupportedRule(RecurrenceRejection.ORDINAL_WEEKDAY)
        day = _ICAL_TO_DAY.get(token)
        if day is None:
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
        names.append(day)
    return names


def _monthly_day(by_month_day: Any, by_set_pos: Any, dtstart: date) -> int | UnsupportedRule:
    """Read the target day back, including the clamped pair this module emits."""
    if not by_month_day:
        if by_set_pos:
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
        return _unclamped(dtstart.day)

    values = [int(v) for v in (by_month_day if isinstance(by_month_day, list) else [by_month_day])]
    if len(values) == 1:
        if by_set_pos and int(_single(by_set_pos)) != 1:
            return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_PART)
        only = values[0]
        # A rule anchored to the last day means the same series as the clamped
        # 31st, which is how the expander already stores it.
        if only == -1:
            return _LAST_DAY_OF_MONTH
        day = _day_of_month(only)
        return day if isinstance(day, UnsupportedRule) else _unclamped(day)

    positives = sorted(v for v in values if v > 0)
    if len(values) == 2 and -1 in values and len(positives) == 1:  # noqa: PLR2004
        if not by_set_pos or int(_single(by_set_pos)) != 1:
            return UnsupportedRule(RecurrenceRejection.MULTIPLE_MONTH_DAYS)
        return _day_of_month(positives[0])
    return UnsupportedRule(RecurrenceRejection.MULTIPLE_MONTH_DAYS)


def _counts_weeks_elsewhere(frequency: str, interval: int, week_start: Any) -> bool:
    """Whether the rule counts its weeks from a day the expander does not.

    Only an interval above one can disagree: every week start selects the same
    days when the rule repeats every week.
    """
    if frequency != _FREQ_WEEKLY or interval == 1 or week_start is None:
        return False
    return str(week_start).upper() != _WEEK_START


def _unclamped(day: int) -> int | UnsupportedRule:
    """Refuse a day the two calendars disagree about.

    RFC 5545 skips a month that has no such day; the expander pulls the
    occurrence back to the last one. Importing it either way silently moves
    meetings, so the row goes to the skipped report instead. The BYSETPOS pair
    this module emits states the clamp explicitly and is read back above.
    """
    if day in _CLAMPED_DAYS or day == _LAST_DAY_OF_MONTH:
        return UnsupportedRule(RecurrenceRejection.CLAMPED_MONTH_DAY)
    return day


def _day_of_month(day: int) -> int | UnsupportedRule:
    """Only a day the expander can build a date from survives import.

    Counting backwards has no representation beyond the last day, so accepting
    a second-to-last day would store a number that raises when the series is
    next expanded - taking the whole range read down with it.
    """
    if 1 <= day <= _LAST_DAY_OF_MONTH:
        return day
    return UnsupportedRule(RecurrenceRejection.UNSUPPORTED_MONTH_DAY)
