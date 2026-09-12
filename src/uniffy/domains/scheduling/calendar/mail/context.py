"""Template context for event mail.

The mail environment uses StrictUndefined, so every key a template can
reference is emitted here unconditionally - an absent value becomes an empty
string, never a missing key.
"""

import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from uniffy.core.content.references import MENTION_PATTERN
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.shared import DayOfWeek, RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import (
    occurrence_start_for_date,
    resolve_event_zone,
)

_DEFAULT_BASE_URL = "http://localhost:5173"
_NAMES_SHOWN = 3

_WEEKDAY_LABELS: dict[str, str] = {
    DayOfWeek.MONDAY.value: "Monday",
    DayOfWeek.TUESDAY.value: "Tuesday",
    DayOfWeek.WEDNESDAY.value: "Wednesday",
    DayOfWeek.THURSDAY.value: "Thursday",
    DayOfWeek.FRIDAY.value: "Friday",
    DayOfWeek.SATURDAY.value: "Saturday",
    DayOfWeek.SUNDAY.value: "Sunday",
}

_FREQUENCY_LABELS: dict[RecurrencePattern, str] = {
    RecurrencePattern.DAILY: "day",
    RecurrencePattern.WEEKLY: "week",
    RecurrencePattern.BIWEEKLY: "two weeks",
    RecurrencePattern.MONTHLY: "month",
    RecurrencePattern.YEARLY: "year",
}


@dataclass(frozen=True)
class RespondLinks:
    accept: str = ""
    tentative: str = ""
    decline: str = ""


def base_url() -> str:
    return os.getenv("UNIFFY_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


def event_url(event_id) -> str:
    return f"{base_url()}/calendar/event/{event_id}"


def preferences_url() -> str:
    return f"{base_url()}/settings/notifications"


def respond_links(token: str) -> RespondLinks:
    """Links to the page that submits the response.

    The page posts the token rather than the link itself carrying the effect,
    so a mail scanner opening every URL cannot accept a meeting for somebody.
    """
    page = f"{base_url()}/calendar/respond"
    return RespondLinks(
        accept=f"{page}?token={token}&response=accepted",
        tentative=f"{page}?token={token}&response=tentative",
        decline=f"{page}?token={token}&response=declined",
    )


def build_context(
    event: CalendarEvent,
    *,
    organization_name: str,
    organizer_name: str,
    recipient_timezone: str | None,
    attendee_names: Sequence[str] = (),
    respond: RespondLinks | None = None,
    changes: Sequence[str] = (),
    occurrence_date: date | None = None,
) -> dict:
    """Every key the calendar templates can reference, always present."""
    zone = resolve_event_zone(recipient_timezone or event.timezone)
    links = respond or RespondLinks()
    start = _occurrence_start(event, occurrence_date, zone)

    return {
        "organization_name": organization_name,
        "title": event.title,
        "organizer_name": organizer_name,
        "when": _format_when(event, start, zone),
        "when_short": start.strftime("%-d %b %H:%M")
        if not event.is_all_day
        else start.strftime("%-d %b"),
        "recurrence": describe_recurrence(event),
        "location": event.location or "",
        "attendee_summary": summarize_attendees(attendee_names),
        "join_url": event.meeting_url or "",
        "description": _plain_text(event.description),
        "respond_accept_url": links.accept,
        "respond_tentative_url": links.tentative,
        "respond_decline_url": links.decline,
        "action_url": event_url(event.id),
        "preferences_url": preferences_url(),
        "timezone_label": str(zone),
        "changes": list(changes),
        "occurrence_only": occurrence_date is not None,
    }


def describe_recurrence(event: CalendarEvent) -> str:
    """A one-line human description, or empty for an event that happens once."""
    if event.recurrence_pattern == RecurrencePattern.NONE:
        return ""
    config = event.recurrence_config or {}
    interval = max(1, config.get("interval", 1))
    unit = _FREQUENCY_LABELS.get(event.recurrence_pattern, "")
    if not unit:
        return ""

    if event.recurrence_pattern == RecurrencePattern.BIWEEKLY:
        cadence = "every two weeks" if interval == 1 else f"every {interval * 2} weeks"
    elif interval == 1:
        cadence = f"every {unit}"
    else:
        cadence = f"every {interval} {unit}s"

    days = [
        _WEEKDAY_LABELS[day] for day in config.get("days_of_week") or [] if day in _WEEKDAY_LABELS
    ]
    if days and event.recurrence_pattern in (
        RecurrencePattern.WEEKLY,
        RecurrencePattern.BIWEEKLY,
        RecurrencePattern.DAILY,
    ):
        return f"Repeats {cadence} on {_join_names(days)}"
    return f"Repeats {cadence}"


def summarize_attendees(names: Sequence[str]) -> str:
    """Name a few people, then count the rest; a long roster is unreadable."""
    cleaned = [name for name in names if name]
    if not cleaned:
        return ""
    if len(cleaned) <= _NAMES_SHOWN:
        return _join_names(cleaned)
    remaining = len(cleaned) - _NAMES_SHOWN
    others = "other" if remaining == 1 else "others"
    return f"{', '.join(cleaned[:_NAMES_SHOWN])} and {remaining} {others}"


def _occurrence_start(
    event: CalendarEvent, occurrence_date: date | None, zone: ZoneInfo
) -> datetime:
    """Resolve the occurrence where the meeting lives, then read it where the
    recipient does.

    Substituting the date after converting to the reader's zone uses their wall
    clock, which drifts by an hour whenever the two zones cross daylight saving
    on different days. An all-day event carries a date rather than an instant,
    so converting it at all would move it to the day before for anyone west of
    the organizer.
    """
    start = (
        event.start_time
        if occurrence_date is None
        else occurrence_start_for_date(event.start_time, event.timezone, occurrence_date)
    )
    if event.is_all_day:
        return start.astimezone(resolve_event_zone(event.timezone))
    return start.astimezone(zone)


def _format_when(event: CalendarEvent, start: datetime, zone: ZoneInfo) -> str:
    if event.is_all_day:
        return start.strftime("%A %-d %B %Y (all day)")
    end = start + (event.end_time - event.start_time)
    return f"{start.strftime('%A %-d %B %Y, %H:%M')} - {end.strftime('%H:%M')} ({zone})"


def _join_names(names: Sequence[str]) -> str:
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _plain_text(markdown: str) -> str:
    if not markdown:
        return ""
    return MENTION_PATTERN.sub(lambda match: match.group(1), markdown)
