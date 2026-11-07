"""A Uniffy event as the body Google or Graph expects; Uniffy-only fields never leave."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from uniffy.core.models.calendar.connection import SyncFailure
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.participant import CalendarEventParticipant, ParticipantResponse
from uniffy.core.types import EventStatus, EventTransparency, EventVisibility, RecurrencePattern
from uniffy.domains.scheduling.calendar.connections.providers.base import ProviderError
from uniffy.domains.scheduling.calendar.connections.recurrence import rrule_to_graph_pattern
from uniffy.domains.scheduling.calendar.ical.emit import plain_text
from uniffy.domains.scheduling.calendar.ical.rrule import config_to_rrule
from uniffy.domains.scheduling.calendar.recurrence import resolve_event_zone

_JOIN_PREFIX = "Join: "
_GOOGLE_RESPONSES = {
    ParticipantResponse.ACCEPTED: "accepted",
    ParticipantResponse.TENTATIVE: "tentative",
    ParticipantResponse.DECLINED: "declined",
    ParticipantResponse.PENDING: "needsAction",
}


@dataclass(frozen=True)
class Guest:
    email: str
    name: str | None = None
    optional: bool = False
    response: ParticipantResponse = ParticipantResponse.PENDING


@dataclass(frozen=True)
class OutboundEvent:
    """Everything a push needs about one event, read in the job's own transaction."""

    event: CalendarEvent
    guests: tuple[Guest, ...]
    cancelled_dates: tuple[date, ...]
    # The provider runs its own meeting link, so ours is not appended.
    provider_conference: bool


def outbound_description(event: CalendarEvent, provider_conference: bool) -> str:
    text = plain_text(event.description or "")
    if event.meeting_url and not provider_conference:
        # Stripped again on the way in, so it never doubles.
        text = (
            f"{text.rstrip()}\n\n{_JOIN_PREFIX}{event.meeting_url}"
            if text.strip()
            else (f"{_JOIN_PREFIX}{event.meeting_url}")
        )
    return text


def guests_of(
    member_emails: list[tuple[str, str | None, bool]],
    participants: list[CalendarEventParticipant],
) -> tuple[Guest, ...]:
    """Members as Uniffy lists them, plus outside guests exactly as the provider last sent them."""
    guests: dict[str, Guest] = {}
    for participant in participants:
        if participant.is_organizer:
            continue
        guests[participant.email] = Guest(
            email=participant.email,
            name=participant.display_name,
            optional=participant.is_optional,
            response=participant.response,
        )
    for email, name, optional in member_emails:
        existing = guests.get(email)
        guests[email] = Guest(
            email=email,
            name=name,
            optional=optional,
            response=existing.response if existing else ParticipantResponse.PENDING,
        )
    return tuple(sorted(guests.values(), key=lambda guest: guest.email))


def _local(value: datetime, zone: str) -> datetime:
    return value.astimezone(resolve_event_zone(zone))


def _rrule(event: CalendarEvent) -> str | None:
    if event.recurrence_pattern == RecurrencePattern.NONE:
        return None
    return config_to_rrule(
        pattern=event.recurrence_pattern,
        config=event.recurrence_config,
        timezone=event.timezone,
        start_date=_series_start(event, event.timezone),
    )


def _series_start(event: CalendarEvent, zone: str) -> date:
    # All-day events are stored at UTC midnight; their own zone would shift the weekday.
    if event.is_all_day:
        return event.start_time.astimezone(UTC).date()
    return _local(event.start_time, zone).date()


def google_body(outbound: OutboundEvent, *, occurrence: bool = False) -> dict[str, Any]:
    event = outbound.event
    zone = event.timezone or "UTC"
    body: dict[str, Any] = {
        "summary": event.title,
        "description": outbound_description(event, outbound.provider_conference),
        "location": event.location or "",
        "visibility": "private" if event.visibility == EventVisibility.PRIVATE else "default",
        "transparency": (
            "transparent" if event.transparency == EventTransparency.TRANSPARENT else "opaque"
        ),
        "status": "tentative" if event.status == EventStatus.TENTATIVE else "confirmed",
        "attendees": [
            {
                "email": guest.email,
                **({"displayName": guest.name} if guest.name else {}),
                **({"optional": True} if guest.optional else {}),
                "responseStatus": _GOOGLE_RESPONSES[guest.response],
            }
            for guest in outbound.guests
        ],
    }
    if event.is_all_day:
        start_day = event.start_time.astimezone(UTC).date()
        end_day = max(event.end_time.astimezone(UTC).date(), start_day + timedelta(days=1))
        # The unused shape is cleared, or a patch from timed to all-day is refused.
        body["start"] = {"date": start_day.isoformat(), "dateTime": None}
        body["end"] = {"date": end_day.isoformat(), "dateTime": None}
    else:
        body["start"] = {
            "dateTime": _local(event.start_time, zone).isoformat(),
            "timeZone": zone,
            "date": None,
        }
        body["end"] = {
            "dateTime": _local(event.end_time, zone).isoformat(),
            "timeZone": zone,
            "date": None,
        }
    if not occurrence:
        rule = _rrule(event)
        if rule is not None:
            lines = [f"RRULE:{rule}"]
            if outbound.cancelled_dates:
                lines.append(_google_exdates(event, outbound.cancelled_dates))
            body["recurrence"] = lines
        else:
            body["recurrence"] = []
    return body


def _google_exdates(event: CalendarEvent, days: tuple[date, ...]) -> str:
    if event.is_all_day:
        return "EXDATE;VALUE=DATE:" + ",".join(day.strftime("%Y%m%d") for day in sorted(days))
    zone = event.timezone or "UTC"
    local = _local(event.start_time, zone)
    # Wall-clock stamps in the series zone, as the TZID parameter declares.
    stamps = [f"{day.strftime('%Y%m%d')}T{local.strftime('%H%M%S')}" for day in sorted(days)]
    return f"EXDATE;TZID={zone}:" + ",".join(stamps)


def graph_body(outbound: OutboundEvent, *, occurrence: bool = False) -> dict[str, Any]:
    event = outbound.event
    zone = event.timezone or "UTC"
    body: dict[str, Any] = {
        "subject": event.title,
        "body": {
            "contentType": "text",
            "content": outbound_description(event, outbound.provider_conference),
        },
        "location": {"displayName": event.location or ""},
        "sensitivity": "private" if event.visibility == EventVisibility.PRIVATE else "normal",
        "showAs": "free"
        if event.transparency == EventTransparency.TRANSPARENT
        else ("tentative" if event.status == EventStatus.TENTATIVE else "busy"),
        "isAllDay": event.is_all_day,
        "attendees": [
            {
                "emailAddress": {
                    "address": guest.email,
                    **({"name": guest.name} if guest.name else {}),
                },
                "type": "optional" if guest.optional else "required",
            }
            for guest in outbound.guests
        ],
    }
    if event.is_all_day:
        start_day = event.start_time.astimezone(UTC).date()
        end_day = max(event.end_time.astimezone(UTC).date(), start_day + timedelta(days=1))
        body["start"] = {"dateTime": f"{start_day.isoformat()}T00:00:00", "timeZone": "UTC"}
        body["end"] = {"dateTime": f"{end_day.isoformat()}T00:00:00", "timeZone": "UTC"}
    else:
        body["start"] = {"dateTime": _wall(event.start_time, zone), "timeZone": _graph_zone(zone)}
        body["end"] = {"dateTime": _wall(event.end_time, zone), "timeZone": _graph_zone(zone)}
    if not occurrence:
        rule = _rrule(event)
        pattern = (
            rrule_to_graph_pattern(
                rule, start_date=_series_start(event, zone), time_zone=_graph_zone(zone)
            )
            if rule
            else None
        )
        if rule and pattern is None:
            # Sending no pattern would turn the series into one meeting on Outlook.
            raise ProviderError(SyncFailure.UNPROCESSABLE, reason="pattern_not_expressible")
        body["recurrence"] = pattern
    return body


def _wall(value: datetime, zone: str) -> str:
    return _local(value, zone).replace(tzinfo=None).isoformat(timespec="seconds")


def _graph_zone(zone: str) -> str:
    # Graph accepts IANA names; an unknown zone falls back to UTC rather than being refused.
    try:
        ZoneInfo(zone)
    except KeyError, ValueError:
        return "UTC"
    return zone
