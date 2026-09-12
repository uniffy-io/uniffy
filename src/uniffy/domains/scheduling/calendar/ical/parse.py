"""Reading a VCALENDAR into rows this product can store.

Anything the in-house vocabulary cannot express is reported rather than
approximated: a silently reshaped meeting is worse than a skipped one.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from icalendar import Calendar

from uniffy.core.errors import ValidationError
from uniffy.core.types import (
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrencePattern,
)
from uniffy.domains.scheduling.calendar.ical.rrule import (
    UnsupportedRule,
    rrule_to_config,
)
from uniffy.domains.scheduling.calendar.recurrence import resolve_event_zone

# A hostile or careless .ics is untrusted input, so both the payload and the
# component count are bounded before anything is built from them.
MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_EVENTS = 2000

TITLE_LIMIT = 500
LOCATION_LIMIT = 500
URL_LIMIT = 2000
_UNTITLED = "(untitled)"

_UTC = ZoneInfo("UTC")

_TRANSP_TRANSPARENT = "TRANSPARENT"
# CONFIDENTIAL carries a stronger intent than PRIVATE, and the model has one
# private tier, so both land there rather than degrading to public.
_PRIVATE_CLASSES = frozenset({"PRIVATE", "CONFIDENTIAL"})

_STATUS_FROM_ICAL: dict[str, EventStatus] = {
    "CONFIRMED": EventStatus.CONFIRMED,
    "TENTATIVE": EventStatus.TENTATIVE,
    "CANCELLED": EventStatus.CANCELLED,
}


class ImportRejection(StrEnum):
    """Why a component could not become an event."""

    MALFORMED_DOCUMENT = "MALFORMED_DOCUMENT"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    TOO_MANY_EVENTS = "TOO_MANY_EVENTS"
    MISSING_START = "MISSING_START"
    MISSING_UID = "MISSING_UID"
    UNSUPPORTED_RECURRENCE = "UNSUPPORTED_RECURRENCE"
    ORPHAN_OCCURRENCE = "ORPHAN_OCCURRENCE"
    UNREADABLE_COMPONENT = "UNREADABLE_COMPONENT"


_REJECTION_MESSAGES: dict[ImportRejection, str] = {
    ImportRejection.MALFORMED_DOCUMENT: "The file is not a readable calendar.",
    ImportRejection.PAYLOAD_TOO_LARGE: "The file is larger than the import limit.",
    ImportRejection.TOO_MANY_EVENTS: "The file holds more events than one import allows.",
    ImportRejection.MISSING_START: "The entry states no start time.",
    ImportRejection.MISSING_UID: "The entry carries no unique identifier.",
    ImportRejection.UNSUPPORTED_RECURRENCE: "The repeat rule is not supported.",
    ImportRejection.ORPHAN_OCCURRENCE: (
        "The entry changes one occurrence of a series the file does not contain."
    ),
    ImportRejection.UNREADABLE_COMPONENT: "The entry could not be read.",
}


def _refuse(rejection: ImportRejection) -> ValidationError:
    """A whole-document failure, as opposed to one skipped entry."""
    return ValidationError("file", _REJECTION_MESSAGES[rejection])


@dataclass(frozen=True)
class SkippedEntry:
    label: str
    rejection: ImportRejection
    detail: str = ""

    @property
    def message(self) -> str:
        base = _REJECTION_MESSAGES[self.rejection]
        return f"{base} {self.detail}".strip()


@dataclass(frozen=True)
class ParsedOccurrence:
    """A VEVENT carrying RECURRENCE-ID: one occurrence moved or reshaped."""

    original_date: date
    event: ParsedEvent


@dataclass(frozen=True)
class ParsedEvent:
    ical_uid: str
    title: str
    start_time: datetime
    end_time: datetime
    timezone: str
    is_all_day: bool = False
    description: str = ""
    location: str = ""
    meeting_url: str | None = None
    status: EventStatus = EventStatus.CONFIRMED
    visibility: EventVisibility = EventVisibility.STANDARD
    transparency: EventTransparency = EventTransparency.OPAQUE
    recurrence_pattern: RecurrencePattern = RecurrencePattern.NONE
    recurrence_config: dict[str, Any] | None = None
    cancelled_dates: tuple[date, ...] = ()
    overrides: tuple[ParsedOccurrence, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ParsedCalendar:
    events: tuple[ParsedEvent, ...]
    skipped: tuple[SkippedEntry, ...]


def parse_calendar(payload: bytes) -> ParsedCalendar:
    """Read every VEVENT the document holds, reporting what could not be used."""
    if len(payload) > MAX_IMPORT_BYTES:
        raise _refuse(ImportRejection.PAYLOAD_TOO_LARGE)

    try:
        document = Calendar.from_ical(payload)
    except Exception as exc:  # noqa: BLE001 - any parser failure is one bad file
        raise _refuse(ImportRejection.MALFORMED_DOCUMENT) from exc

    components = list(document.walk("VEVENT"))
    if len(components) > MAX_IMPORT_EVENTS:
        raise _refuse(ImportRejection.TOO_MANY_EVENTS)

    skipped: list[SkippedEntry] = []
    masters: dict[str, ParsedEvent] = {}
    occurrences: list[tuple[str, ParsedOccurrence]] = []

    for component in components:
        try:
            _read_component(component, masters, occurrences, skipped)
        except Exception:  # noqa: BLE001 - one bad entry must not fail the file
            skipped.append(SkippedEntry(_label(component), ImportRejection.UNREADABLE_COMPONENT))

    return ParsedCalendar(
        events=tuple(_attach(masters, occurrences, skipped)),
        skipped=tuple(skipped),
    )


def _read_component(
    component: Any,
    masters: dict[str, ParsedEvent],
    occurrences: list[tuple[str, ParsedOccurrence]],
    skipped: list[SkippedEntry],
) -> None:
    label = _label(component)

    uid = str(component.get("uid") or "").strip()
    if not uid:
        skipped.append(SkippedEntry(label, ImportRejection.MISSING_UID))
        return

    started = component.get("dtstart")
    if started is None:
        skipped.append(SkippedEntry(label, ImportRejection.MISSING_START))
        return

    parsed = _build_event(component, uid=uid, label=label, skipped=skipped)
    if parsed is None:
        return

    recurrence_id = component.get("recurrence-id")
    if recurrence_id is None:
        masters[uid] = parsed
        return

    occurrences.append((
        uid,
        ParsedOccurrence(original_date=_as_date(recurrence_id.dt), event=parsed),
    ))


def _build_event(
    component: Any,
    *,
    uid: str,
    label: str,
    skipped: list[SkippedEntry],
) -> ParsedEvent | None:
    raw_start = component.get("dtstart").dt
    is_all_day = isinstance(raw_start, date) and not isinstance(raw_start, datetime)
    tzid = _tzid_of(component.get("dtstart"), raw_start)
    zone = resolve_event_zone(tzid)

    start = _to_instant(raw_start, zone)
    end = _resolve_end(component, raw_start, zone, is_all_day)

    pattern = RecurrencePattern.NONE
    config: dict[str, Any] | None = None
    rule = component.get("rrule")
    if rule is not None:
        mapped = rrule_to_config(rule.to_ical().decode(), dtstart=start.astimezone(zone).date())
        if isinstance(mapped, UnsupportedRule):
            skipped.append(
                SkippedEntry(label, ImportRejection.UNSUPPORTED_RECURRENCE, mapped.message)
            )
            return None
        pattern, config = mapped.pattern, mapped.config

    return ParsedEvent(
        ical_uid=uid,
        title=_text(component.get("summary"), TITLE_LIMIT) or _UNTITLED,
        start_time=start,
        end_time=end,
        timezone=tzid,
        is_all_day=is_all_day,
        description=_text(component.get("description"), None),
        location=_text(component.get("location"), LOCATION_LIMIT),
        meeting_url=_text(component.get("url"), URL_LIMIT) or None,
        status=_STATUS_FROM_ICAL.get(
            str(component.get("status") or "").upper(), EventStatus.CONFIRMED
        ),
        visibility=(
            EventVisibility.PRIVATE
            if str(component.get("class") or "").upper() in _PRIVATE_CLASSES
            else EventVisibility.STANDARD
        ),
        transparency=(
            EventTransparency.TRANSPARENT
            if str(component.get("transp") or "").upper() == _TRANSP_TRANSPARENT
            else EventTransparency.OPAQUE
        ),
        recurrence_pattern=pattern,
        recurrence_config=config,
        cancelled_dates=tuple(sorted(set(_exdates(component, zone)))),
    )


def _attach(
    masters: dict[str, ParsedEvent],
    occurrences: list[tuple[str, ParsedOccurrence]],
    skipped: list[SkippedEntry],
) -> Iterable[ParsedEvent]:
    """Hang each RECURRENCE-ID entry off its series; an orphan is reported."""
    by_uid: dict[str, list[ParsedOccurrence]] = {}
    for uid, occurrence in occurrences:
        if uid not in masters:
            skipped.append(SkippedEntry(occurrence.event.title, ImportRejection.ORPHAN_OCCURRENCE))
            continue
        by_uid.setdefault(uid, []).append(occurrence)

    for uid, master in masters.items():
        attached = by_uid.get(uid)
        if not attached:
            yield master
            continue
        yield replace(
            master,
            overrides=tuple(sorted(attached, key=lambda item: item.original_date)),
        )


def _resolve_end(component: Any, raw_start: Any, zone: ZoneInfo, is_all_day: bool) -> datetime:
    """DTEND is optional; RFC 5545 falls back to DURATION, then to a default."""
    ended = component.get("dtend")
    if ended is not None:
        return _to_instant(ended.dt, zone)

    duration = component.get("duration")
    if duration is not None:
        return _to_instant(raw_start, zone) + duration.dt

    # A DATE start with neither takes one day; a DATE-TIME start takes no time.
    span = timedelta(days=1) if is_all_day else timedelta(0)
    return _to_instant(raw_start, zone) + span


def _exdates(component: Any, zone: ZoneInfo) -> list[date]:
    raw = component.get("exdate")
    if raw is None:
        return []
    entries = raw if isinstance(raw, list) else [raw]
    return [
        _as_date(item.dt if not isinstance(item.dt, datetime) else item.dt.astimezone(zone))
        for entry in entries
        for item in entry.dts
    ]


def _tzid_of(prop: Any, raw: Any) -> str:
    """The stated TZID, else the value's own zone, else UTC."""
    stated = prop.params.get("TZID") if hasattr(prop, "params") else None
    if stated:
        return str(stated)
    if isinstance(raw, datetime) and raw.tzinfo is not None:
        return str(getattr(raw.tzinfo, "key", "UTC"))
    return "UTC"


def _to_instant(value: Any, zone: ZoneInfo) -> datetime:
    """Every stored time is a UTC instant; a floating time takes the event's zone."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo is not None else value.replace(tzinfo=zone)
        return moment.astimezone(_UTC)
    return datetime(value.year, value.month, value.day, tzinfo=zone).astimezone(_UTC)


def _as_date(value: Any) -> date:
    return value.date() if isinstance(value, datetime) else value


def _text(value: Any, limit: int | None) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text[:limit] if limit else text


def _label(component: Any) -> str:
    return _text(component.get("summary"), TITLE_LIMIT) or _UNTITLED
