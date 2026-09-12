"""VCALENDAR emission from calendar events."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event, Timezone, vCalAddress, vText
from icalendar.prop import vDuration

from uniffy.core.content.references import MENTION_PATTERN
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.core.types import EventStatus, EventTransparency, EventVisibility
from uniffy.domains.scheduling.calendar.ical.rrule import config_to_rrule
from uniffy.domains.scheduling.calendar.recurrence import (
    occurrence_start_for_date,
    resolve_event_zone,
)

PRODUCT_ID = "-//Uniffy//Uniffy Calendar//EN"
ICAL_VERSION = "2.0"
DEFAULT_UID_DOMAIN = "uniffy"

# What a private event says to somebody who may see that it happens but not
# what it is about.
BUSY_SUMMARY = "Busy"

_UTC = ZoneInfo("UTC")
_MIDNIGHT = time(0, 0)

_ROLE_TO_ICAL: dict[AttendeeRole, str] = {
    AttendeeRole.ORGANIZER: "CHAIR",
    AttendeeRole.REQUIRED: "REQ-PARTICIPANT",
    AttendeeRole.OPTIONAL: "OPT-PARTICIPANT",
}
_STATUS_TO_PARTSTAT: dict[AttendeeStatus, str] = {
    AttendeeStatus.PENDING: "NEEDS-ACTION",
    AttendeeStatus.ACCEPTED: "ACCEPTED",
    AttendeeStatus.TENTATIVE: "TENTATIVE",
    AttendeeStatus.DECLINED: "DECLINED",
}
_EVENT_STATUS_TO_ICAL: dict[EventStatus, str] = {
    EventStatus.CONFIRMED: "CONFIRMED",
    EventStatus.TENTATIVE: "TENTATIVE",
    EventStatus.CANCELLED: "CANCELLED",
}


@dataclass(frozen=True)
class IcalPerson:
    email: str
    name: str = ""


@dataclass(frozen=True)
class IcalAttendee:
    person: IcalPerson
    role: AttendeeRole = AttendeeRole.REQUIRED
    status: AttendeeStatus = AttendeeStatus.PENDING


@dataclass(frozen=True)
class EventExport:
    """An event with everything the serializer needs already loaded.

    ``cancelled_dates`` become EXDATE; ``overrides`` become sibling VEVENTs
    carrying RECURRENCE-ID, which is how iCalendar expresses a moved occurrence.
    """

    event: CalendarEvent
    organizer: IcalPerson | None = None
    attendees: Sequence[IcalAttendee] = ()
    cancelled_dates: Sequence[date] = ()
    overrides: Sequence[EventExport] = field(default_factory=tuple)
    sequence: int = 0
    # Set to render this export AS one occurrence of its own series: the times
    # move to that date and a RECURRENCE-ID names it. Withdrawing a single
    # occurrence sends exactly this, with no master alongside it.
    occurrence_date: date | None = None
    # The date this override replaces, which is what RECURRENCE-ID has to name
    # even once the meeting itself has been moved somewhere else.
    original_date: date | None = None
    # The private-event policy: the block is honest about when, and says
    # nothing about what.
    details_hidden: bool = False


def serialize_events(
    exports: Sequence[EventExport],
    *,
    method: str | None = None,
    uid_domain: str = DEFAULT_UID_DOMAIN,
    calendar_name: str | None = None,
    refresh_interval: timedelta | None = None,
) -> bytes:
    """Render a VCALENDAR carrying every export and the zones they reference.

    ``calendar_name`` and ``refresh_interval`` are subscription hints outside
    RFC 5545; every major client reads them and the rest ignore them.
    """
    calendar = Calendar()
    calendar.add("prodid", PRODUCT_ID)
    calendar.add("version", ICAL_VERSION)
    calendar.add("calscale", "GREGORIAN")
    if method:
        calendar.add("method", method)
    if calendar_name:
        calendar.add("x-wr-calname", calendar_name)
    if refresh_interval:
        # Apple reads REFRESH-INTERVAL, Outlook reads X-PUBLISHED-TTL; both
        # carry the same duration so the poll rate does not depend on client.
        calendar.add("refresh-interval", refresh_interval, parameters={"VALUE": "DURATION"})
        # X- properties carry no type, so the duration is spelled out by hand.
        calendar.add("x-published-ttl", vDuration(refresh_interval).to_ical().decode("ascii"))

    for tzid in _referenced_zones(exports):
        calendar.add_component(Timezone.from_tzid(tzid))

    for export in exports:
        calendar.add_component(_build_event(export, uid_domain=uid_domain))
        for override in export.overrides:
            calendar.add_component(
                _build_event(
                    override,
                    uid_domain=uid_domain,
                    series_uid=_uid(export.event, uid_domain),
                    master=export.event,
                )
            )

    return calendar.to_ical()


def _build_event(
    export: EventExport,
    *,
    uid_domain: str,
    series_uid: str | None = None,
    master: CalendarEvent | None = None,
) -> Event:
    event = export.event
    tz = resolve_event_zone(event.timezone)
    component = Event()

    component.add("uid", series_uid or _uid(event, uid_domain))
    component.add("dtstamp", event.updated_at.astimezone(_UTC))
    component.add("created", event.created_at.astimezone(_UTC))
    component.add("last-modified", event.updated_at.astimezone(_UTC))
    component.add("sequence", export.sequence)
    component.add("summary", BUSY_SUMMARY if export.details_hidden else event.title)

    if export.occurrence_date is not None:
        _add_occurrence_times(component, event, tz, export.occurrence_date)
    else:
        _add_times(component, event, tz)

    if event.description and not export.details_hidden:
        component.add("description", _plain_text(event.description))
    if event.location and not export.details_hidden:
        component.add("location", event.location)
    if event.meeting_url and not export.details_hidden:
        component.add("url", event.meeting_url)

    component.add("status", _EVENT_STATUS_TO_ICAL[event.status])
    component.add(
        "transp",
        "TRANSPARENT" if event.transparency == EventTransparency.TRANSPARENT else "OPAQUE",
    )
    if event.visibility == EventVisibility.PRIVATE:
        component.add("class", "PRIVATE")

    if export.organizer:
        component.add("organizer", _cal_address(export.organizer), encode=0)
    if not export.details_hidden:
        for attendee in export.attendees:
            component.add("attendee", _attendee_address(attendee), encode=0)

    # A single occurrence carries no rule of its own; the series it names
    # already holds one.
    rrule = (
        None
        if export.occurrence_date is not None
        else config_to_rrule(
            pattern=event.recurrence_pattern,
            config=event.recurrence_config,
            timezone=event.timezone,
            start_date=event.start_time.astimezone(tz).date(),
        )
    )
    if rrule:
        component.add("rrule", rrule)
    if export.cancelled_dates:
        _add_exdates(component, event, tz, export.cancelled_dates)

    if master is not None:
        component.add("recurrence-id", _occurrence_value(master, export, tz))
    elif export.occurrence_date is not None:
        component.add(
            "recurrence-id",
            export.occurrence_date
            if event.is_all_day
            else occurrence_start_for_date(
                event.start_time, event.timezone, export.occurrence_date
            ).astimezone(tz),
        )

    return component


def _add_occurrence_times(
    component: Event, event: CalendarEvent, tz: ZoneInfo, occurrence: date
) -> None:
    """Move the series times onto one occurrence, keeping the local wall clock."""
    if event.is_all_day:
        component.add("dtstart", occurrence)
        component.add("dtend", occurrence + timedelta(days=1))
        return
    start = occurrence_start_for_date(event.start_time, event.timezone, occurrence)
    component.add("dtstart", start.astimezone(tz))
    component.add("dtend", (start + (event.end_time - event.start_time)).astimezone(tz))


def _add_times(component: Event, event: CalendarEvent, tz: ZoneInfo) -> None:
    """All-day events carry DATE values with an exclusive end, per RFC 5545."""
    local_start = event.start_time.astimezone(tz)
    local_end = event.end_time.astimezone(tz)

    if not event.is_all_day:
        component.add("dtstart", local_start)
        component.add("dtend", local_end)
        return

    start_day = local_start.date()
    # A stored end of next-day midnight is already exclusive; an end late on the
    # closing day is inclusive and has to be pushed past it.
    end_day = (
        local_end.date()
        if local_end.timetz().replace(tzinfo=None) == _MIDNIGHT
        else (local_end.date() + timedelta(days=1))
    )
    component.add("dtstart", start_day)
    component.add("dtend", max(end_day, start_day + timedelta(days=1)))


def _add_exdates(
    component: Event,
    event: CalendarEvent,
    tz: ZoneInfo,
    cancelled: Sequence[date],
) -> None:
    """EXDATE values have to match the occurrence DTSTART they cancel exactly,
    so a timed series excludes instants rather than bare dates.
    """
    ordered = sorted(set(cancelled))
    if event.is_all_day:
        component.add("exdate", ordered)
        return
    component.add(
        "exdate",
        [
            occurrence_start_for_date(event.start_time, event.timezone, occurrence).astimezone(tz)
            for occurrence in ordered
        ],
    )


def _occurrence_value(master: CalendarEvent, export: EventExport, tz: ZoneInfo) -> datetime | date:
    """RECURRENCE-ID names the occurrence being replaced, not where it moved to.

    A client matches the override to its series by this value, so a meeting
    dragged to another day has to keep pointing at the day it left.
    """
    original = export.original_date
    if master.is_all_day:
        return original or export.event.start_time.astimezone(tz).date()
    if original is None:
        return export.event.start_time.astimezone(tz)
    return occurrence_start_for_date(master.start_time, master.timezone, original).astimezone(tz)


def _referenced_zones(exports: Sequence[EventExport]) -> list[str]:
    """Distinct zones needing a VTIMEZONE, in a stable order for reproducible output."""
    zones: list[str] = []
    for export in exports:
        for candidate in (export, *export.overrides):
            if candidate.event.is_all_day:
                continue
            tzid = candidate.event.timezone
            if tzid and tzid not in zones and _is_known_zone(tzid):
                zones.append(tzid)
    return sorted(zones)


def _is_known_zone(tzid: str) -> bool:
    try:
        ZoneInfo(tzid)
    except KeyError, ValueError:
        return False
    return True


def _uid(event: CalendarEvent, uid_domain: str) -> str:
    """An imported event keeps the UID it arrived with, so exporting it and
    importing it back matches the event already here instead of duplicating it.
    """
    return event.ical_uid or f"{event.id}@{uid_domain}"


def _plain_text(markdown: str) -> str:
    """Mentions render as their label; no external client speaks our markup."""
    return MENTION_PATTERN.sub(lambda match: match.group(1), markdown)


def _cal_address(person: IcalPerson) -> vCalAddress:
    address = vCalAddress(f"MAILTO:{person.email}")
    if person.name:
        address.params["CN"] = vText(person.name)
    return address


def _attendee_address(attendee: IcalAttendee) -> vCalAddress:
    address = _cal_address(attendee.person)
    address.params["ROLE"] = vText(_ROLE_TO_ICAL[attendee.role])
    address.params["PARTSTAT"] = vText(_STATUS_TO_PARTSTAT[attendee.status])
    address.params["RSVP"] = vText("TRUE")
    return address
