"""Translate Graph patterns and Google rule lines to and from the Uniffy series model."""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from uniffy.core.types import EventStatus
from uniffy.domains.scheduling.calendar.connections.normalize import ProviderEvent
from uniffy.domains.scheduling.calendar.ical.rrule import (
    RecurrenceMapping,
    UnsupportedRule,
    rrule_to_config,
)
from uniffy.domains.scheduling.calendar.recurrence import (
    expand_recurrence,
    occurrence_start_for_date,
    resolve_event_zone,
)

_UTC = ZoneInfo("UTC")
_GRAPH_DAYS: dict[str, str] = {
    "monday": "MO",
    "tuesday": "TU",
    "wednesday": "WE",
    "thursday": "TH",
    "friday": "FR",
    "saturday": "SA",
    "sunday": "SU",
}
_ICAL_DAYS = {abbrev: name for name, abbrev in _GRAPH_DAYS.items()}
_DAY_ORDER = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
_GRAPH_INDEX: dict[str, int] = {"first": 1, "second": 2, "third": 3, "fourth": 4, "last": -1}
_INDEX_NAMES = {position: name for name, position in _GRAPH_INDEX.items()}
_COUNT = "COUNT"
_UNTIL = "UNTIL"
_TZID = "TZID"
_RULE_PARTS = frozenset({
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "BYMONTHDAY",
    "BYMONTH",
    _COUNT,
    _UNTIL,
    "WKST",
})
_RRULE_PREFIX = "RRULE:"
# Marks a provider rule Uniffy cannot express; such a series is mirrored instance by instance.
UNSUPPORTED_RECURRENCE = "X-UNSUPPORTED"
_REFUSED_LINES = ("RDATE", "EXRULE", UNSUPPORTED_RECURRENCE)
_DATE_VALUE_LENGTH = 8


def graph_pattern_to_rrule(recurrence: dict[str, Any] | None, *, start_date: date) -> str | None:
    """An RRULE value (no ``RRULE:`` prefix), or None when the pattern has no exact equivalent."""
    if not isinstance(recurrence, dict):
        return None
    pattern = recurrence.get("pattern")
    bound = recurrence.get("range")
    if not isinstance(pattern, dict) or not isinstance(bound, dict):
        return None

    interval = pattern.get("interval")
    interval = interval if isinstance(interval, int) and interval > 0 else 1
    kind = pattern.get("type")
    days = _ical_days(pattern.get("daysOfWeek"))
    month = pattern.get("month")
    day_of_month = pattern.get("dayOfMonth")
    parts: list[str]

    match kind:
        case "daily":
            parts = ["FREQ=DAILY", f"INTERVAL={interval}"]
        case "weekly":
            if not days:
                return None
            parts = ["FREQ=WEEKLY", f"INTERVAL={interval}", f"BYDAY={','.join(days)}"]
            week_start = _GRAPH_DAYS.get(pattern.get("firstDayOfWeek") or "")
            if interval > 1 and week_start:
                parts.append(f"WKST={week_start}")
        case "absoluteMonthly":
            if not _valid_month_day(day_of_month):
                return None
            parts = ["FREQ=MONTHLY", f"INTERVAL={interval}", f"BYMONTHDAY={day_of_month}"]
        case "relativeMonthly":
            position = _GRAPH_INDEX.get(pattern.get("index") or "")
            if position is None or len(days) != 1:
                return None
            parts = ["FREQ=MONTHLY", f"INTERVAL={interval}", f"BYDAY={position}{days[0]}"]
        case "absoluteYearly":
            if not _valid_month(month) or not _valid_month_day(day_of_month):
                return None
            parts = [
                "FREQ=YEARLY",
                f"INTERVAL={interval}",
                f"BYMONTH={month}",
                f"BYMONTHDAY={day_of_month}",
            ]
        case "relativeYearly":
            position = _GRAPH_INDEX.get(pattern.get("index") or "")
            if position is None or len(days) != 1 or not _valid_month(month):
                return None
            parts = [
                "FREQ=YEARLY",
                f"INTERVAL={interval}",
                f"BYMONTH={month}",
                f"BYDAY={position}{days[0]}",
            ]
        case _:
            return None

    match bound.get("type"):
        case "noEnd":
            pass
        case "endDate":
            end = _iso_date(bound.get("endDate"))
            if end is None or end < start_date:
                return None
            parts.append(f"UNTIL={end:%Y%m%d}")
        case "numbered":
            count = bound.get("numberOfOccurrences")
            if not isinstance(count, int) or count < 1:
                return None
            parts.append(f"COUNT={count}")
        case _:
            return None
    return ";".join(parts)


def rrule_to_graph_pattern(rrule: str, *, start_date: date, time_zone: str) -> dict[str, Any] | None:
    """Graph's ``{"pattern", "range"}`` for an RRULE, or None when Graph cannot match it."""
    parts = _rule_parts(rrule)
    if parts is None:
        return None
    try:
        interval = int(parts.get("INTERVAL", "1"))
    except ValueError:
        return None
    if interval < 1:
        return None

    frequency = parts.get("FREQ")
    by_day = parts.get("BYDAY")
    by_month_day = parts.get("BYMONTHDAY")
    by_month = parts.get("BYMONTH")
    pattern: dict[str, Any]

    if frequency == "DAILY":  # noqa: PLR2004 - RFC 5545 frequency
        if by_month_day or by_month:
            return None
        if not by_day:
            pattern = {"type": "daily", "interval": interval}
        elif interval == 1 and (days := _plain_days(by_day)):
            # Every listed weekday, every week: Graph only has the weekly form for it.
            pattern = {
                "type": "weekly",
                "interval": 1,
                "daysOfWeek": days,
                "firstDayOfWeek": "monday",
            }
        else:
            return None
    elif frequency == "WEEKLY":  # noqa: PLR2004 - RFC 5545 frequency
        if by_month_day or by_month:
            return None
        days = _plain_days(by_day) if by_day else [_ICAL_DAYS[_DAY_ORDER[start_date.weekday()]]]
        week_start = _ICAL_DAYS.get(parts.get("WKST", "MO"))
        if not days or week_start is None:
            return None
        pattern = {
            "type": "weekly",
            "interval": interval,
            "daysOfWeek": days,
            "firstDayOfWeek": week_start,
        }
    elif frequency == "MONTHLY":  # noqa: PLR2004 - RFC 5545 frequency
        if by_month:
            return None
        pattern = _monthly_pattern(interval, by_day, by_month_day, start_date)
    elif frequency == "YEARLY":  # noqa: PLR2004 - RFC 5545 frequency
        pattern = _yearly_pattern(interval, by_day, by_month_day, by_month, start_date)
    else:
        return None
    if not pattern:
        return None

    bound = _graph_range(parts, start_date, time_zone)
    if bound is None:
        return None
    return {"pattern": pattern, "range": bound}


def series_rule(master: ProviderEvent) -> tuple[RecurrenceMapping, tuple[date, ...]] | None:
    """The rule and cancelled dates in Uniffy terms, or None when instances must be mirrored."""
    if master.start_time is None:
        return None
    rules: list[str] = []
    exdate_lines: list[str] = []
    for line in master.recurrence:
        head, _, value = line.partition(":")
        name = head.partition(";")[0].strip().upper()
        if name == "RRULE":  # noqa: PLR2004 - RFC 5545 property name
            rules.append(value)
        elif name == "EXDATE":  # noqa: PLR2004 - RFC 5545 property name
            exdate_lines.append(line)
        elif name in _REFUSED_LINES:
            return None
    if len(rules) != 1:
        return None

    zone = _UTC if master.is_all_day else resolve_event_zone(master.timezone)
    cancelled: set[date] = set()
    for line in exdate_lines:
        dates = _exdates(line, zone)
        if dates is None:
            return None
        cancelled.update(dates)

    mapping = rrule_to_config(rules[0], dtstart=master.start_time.astimezone(zone).date())
    if isinstance(mapping, UnsupportedRule):
        return None
    return mapping, tuple(sorted(cancelled))


def reconcile_instances(
    master: ProviderEvent,
    mapping: RecurrenceMapping,
    instances: Sequence[ProviderEvent],
    window_start: datetime,
    window_end: datetime,
) -> tuple[tuple[date, ...], tuple[ProviderEvent, ...]]:
    """Cancelled dates and overrides of a series from its expanded Graph calendarView instances."""
    if master.start_time is None or master.end_time is None:
        return (), ()
    timezone = "UTC" if master.is_all_day else master.timezone
    zone = resolve_event_zone(timezone)
    expected = {
        occurrence.occurrence_date
        for occurrence in expand_recurrence(
            start_time=master.start_time,
            end_time=master.end_time,
            recurrence_pattern=mapping.pattern,
            recurrence_config=mapping.config,
            range_start=window_start,
            range_end=window_end,
            timezone=timezone,
        )
    }
    # The expander leaves the master's own date out; it is an instance like any other here.
    if master.start_time < window_end and master.end_time > window_start:
        expected.add(master.start_time.astimezone(zone).date())

    duration = master.end_time - master.start_time
    present: set[date] = set()
    cancelled: set[date] = set()
    overrides: list[ProviderEvent] = []
    for instance in instances:
        day = instance.original_date
        if day is None:
            continue
        # Attendees keep a cancelled occurrence in their calendarView; the organizer loses it.
        if instance.status == EventStatus.CANCELLED and master.status != EventStatus.CANCELLED:
            cancelled.add(day)
            continue
        present.add(day)
        if master.is_all_day:
            start = datetime(day.year, day.month, day.day, tzinfo=_UTC)
        else:
            start = occurrence_start_for_date(master.start_time, timezone, day)
        if _differs(master, instance, start, start + duration):
            overrides.append(instance)

    cancelled.update(expected - present)
    return tuple(sorted(cancelled)), tuple(overrides)


def _differs(master: ProviderEvent, instance: ProviderEvent, start: datetime, end: datetime) -> bool:
    return (
        instance.start_time != start
        or instance.end_time != end
        or instance.is_all_day != master.is_all_day
        or instance.title != master.title
        or instance.location != master.location
        or instance.description != master.description
        or instance.status != master.status
    )


def _exdates(line: str, zone: ZoneInfo) -> list[date] | None:
    head, separator, values = line.partition(":")
    if not separator:
        return None
    params: dict[str, str] = {}
    for part in head.split(";")[1:]:
        key, _, item = part.partition("=")
        params[key.strip().upper()] = item.strip().strip('"')
    value_zone = resolve_event_zone(params[_TZID]) if params.get(_TZID) else zone
    dates: list[date] = []
    for raw in values.split(","):
        token = raw.strip()
        if not token:
            continue
        try:
            if len(token) == _DATE_VALUE_LENGTH:
                dates.append(datetime.strptime(token, "%Y%m%d").date())  # noqa: DTZ007 - a DATE value has no zone
                continue
            utc = token.endswith("Z")
            moment = datetime.strptime(token.rstrip("Z"), "%Y%m%dT%H%M%S")  # noqa: DTZ007 - zone applied below
        except ValueError:
            return None
        aware = moment.replace(tzinfo=_UTC if utc else value_zone)
        dates.append(aware.astimezone(zone).date())
    return dates


def _rule_parts(rrule: str) -> dict[str, str] | None:
    value = rrule.strip()
    if value.upper().startswith(_RRULE_PREFIX):
        value = value[len(_RRULE_PREFIX) :]
    parts: dict[str, str] = {}
    for chunk in value.split(";"):
        if not chunk.strip():
            continue
        key, separator, item = chunk.partition("=")
        if not separator:
            return None
        key = key.strip().upper()
        if key not in _RULE_PARTS or key in parts:
            return None
        parts[key] = item.strip().upper()
    if _COUNT in parts and _UNTIL in parts:
        return None
    return parts


def _monthly_pattern(
    interval: int, by_day: str | None, by_month_day: str | None, start_date: date
) -> dict[str, Any]:
    if by_day and by_month_day:
        return {}
    if by_day:
        ordinal = _ordinal_day(by_day)
        if ordinal is None:
            return {}
        return {
            "type": "relativeMonthly",
            "interval": interval,
            "daysOfWeek": [ordinal[1]],
            "index": ordinal[0],
        }
    day = _single_month_day(by_month_day) if by_month_day else start_date.day
    if day is None:
        return {}
    return {"type": "absoluteMonthly", "interval": interval, "dayOfMonth": day}


def _yearly_pattern(
    interval: int,
    by_day: str | None,
    by_month_day: str | None,
    by_month: str | None,
    start_date: date,
) -> dict[str, Any]:
    if by_day and by_month_day:
        return {}
    month = _single_month(by_month) if by_month else start_date.month
    if month is None:
        return {}
    if by_day:
        ordinal = _ordinal_day(by_day)
        if ordinal is None or not by_month:
            return {}
        return {
            "type": "relativeYearly",
            "interval": interval,
            "month": month,
            "daysOfWeek": [ordinal[1]],
            "index": ordinal[0],
        }
    day = _single_month_day(by_month_day) if by_month_day else start_date.day
    if day is None or (by_month_day and not by_month):
        return {}
    return {"type": "absoluteYearly", "interval": interval, "month": month, "dayOfMonth": day}


def _graph_range(parts: dict[str, str], start_date: date, time_zone: str) -> dict[str, Any] | None:
    bound: dict[str, Any] = {
        "type": "noEnd",
        "startDate": start_date.isoformat(),
        "recurrenceTimeZone": time_zone,
    }
    if _COUNT in parts:
        try:
            count = int(parts[_COUNT])
        except ValueError:
            return None
        if count < 1:
            return None
        bound.update(type="numbered", numberOfOccurrences=count)
    elif _UNTIL in parts:
        end = _until_date(parts[_UNTIL], time_zone)
        if end is None:
            return None
        bound.update(type="endDate", endDate=end.isoformat())
    return bound


def _until_date(value: str, time_zone: str) -> date | None:
    """UNTIL as the last local day of the series in the recurrence zone."""
    try:
        if len(value) == _DATE_VALUE_LENGTH:
            return datetime.strptime(value, "%Y%m%d").date()  # noqa: DTZ007 - a DATE value has no zone
        moment = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")  # noqa: DTZ007 - zone applied below
    except ValueError:
        return None
    zone = resolve_event_zone(time_zone)
    if value.endswith("Z"):
        return moment.replace(tzinfo=_UTC).astimezone(zone).date()
    return moment.date()


def _ical_days(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    days = {_GRAPH_DAYS[name] for name in value if isinstance(name, str) and name in _GRAPH_DAYS}
    return sorted(days, key=_DAY_ORDER.index)


def _plain_days(by_day: str) -> list[str]:
    """Graph weekday names for a BYDAY list without positions, else an empty list."""
    tokens = [token.strip() for token in by_day.split(",")]
    if any(token not in _ICAL_DAYS for token in tokens):
        return []
    return [_ICAL_DAYS[token] for token in sorted(set(tokens), key=_DAY_ORDER.index)]


def _ordinal_day(by_day: str) -> tuple[str, str] | None:
    """A single positioned weekday like ``2TU`` or ``-1FR`` as Graph's (index, day)."""
    token = by_day.strip()
    if "," in token or len(token) < 3:  # noqa: PLR2004 - shortest positioned BYDAY token
        return None
    day = _ICAL_DAYS.get(token[-2:])
    try:
        position = int(token[:-2])
    except ValueError:
        return None
    index = _INDEX_NAMES.get(position)
    if day is None or index is None:
        return None
    return index, day


def _single_month_day(value: str) -> int | None:
    try:
        day = int(value)
    except ValueError:
        return None
    return day if _valid_month_day(day) else None


def _single_month(value: str) -> int | None:
    try:
        month = int(value)
    except ValueError:
        return None
    return month if _valid_month(month) else None


def _valid_month_day(value: Any) -> bool:
    return isinstance(value, int) and 1 <= value <= 31  # noqa: PLR2004 - calendar bound


def _valid_month(value: Any) -> bool:
    return isinstance(value, int) and 1 <= value <= 12  # noqa: PLR2004 - calendar bound


def _iso_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None
