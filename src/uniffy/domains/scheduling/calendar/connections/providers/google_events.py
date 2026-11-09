"""Read a Google Calendar API v3 event resource into a provider event."""

import html
import re
from datetime import date, datetime, timedelta
from typing import Any

from uniffy.core.models.calendar.participant import ParticipantResponse
from uniffy.core.types import EventStatus, EventTransparency, EventVisibility
from uniffy.domains.scheduling.calendar.connections.identity import normalize_email
from uniffy.domains.scheduling.calendar.connections.normalize import (
    ItemKind,
    ProviderAttendee,
    ProviderEvent,
    SkippedItem,
    SkipReason,
)
from uniffy.domains.scheduling.calendar.connections.providers import fields
from uniffy.domains.scheduling.calendar.recurrence import resolve_event_zone

_RESPONSES: dict[str, ParticipantResponse] = {
    "accepted": ParticipantResponse.ACCEPTED,
    "tentative": ParticipantResponse.TENTATIVE,
    "declined": ParticipantResponse.DECLINED,
    "needsAction": ParticipantResponse.PENDING,
}
_PRIVATE_VISIBILITIES = frozenset({"private", "confidential"})

_BREAK_TAG = re.compile(r"<br\s*/?>|</(?:p|div|ul|ol|h[1-6])\s*>|<li\b[^>]*>", re.IGNORECASE)
_ANCHOR = re.compile(
    r"<a\b[^>]*?href\s*=\s*\"([^\"]*)\"[^>]*>(.*?)</a\s*>", re.IGNORECASE | re.DOTALL
)
# Only things shaped like tags are stripped, so a plain-text "a < b" survives.
_TAG = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>")
_EXTRA_BLANK_LINES = re.compile(r"\n{3,}")


class _UnreadableDateError(Exception):
    pass


def parse_google_event(
    item: dict[str, Any], *, self_email: str | None
) -> ProviderEvent | SkippedItem:
    event_id = item.get("id")
    if not isinstance(event_id, str) or not event_id:
        return SkippedItem(provider_event_id="", reason=SkipReason.MISSING_ID)

    start = item.get("start") if isinstance(item.get("start"), dict) else None
    timezone = fields.zone_name((start or {}).get("timeZone"))
    series_id = (
        item.get("recurringEventId") if isinstance(item.get("recurringEventId"), str) else None
    )

    original_date: date | None = None
    if series_id:
        original_date = _original_date(item.get("originalStartTime"), timezone)
        if original_date is None:
            return SkippedItem(event_id, SkipReason.UNREADABLE_DATE)

    common: dict[str, Any] = {
        "provider_event_id": event_id,
        "ical_uid": fields.ical_uid(item.get("iCalUID")),
        "etag": item["etag"] if isinstance(item.get("etag"), str) else None,
        "updated_at": fields.instant(item.get("updated")),
        "sequence": item["sequence"] if isinstance(item.get("sequence"), int) else None,
        "series_id": series_id,
        "original_date": original_date,
    }

    if item.get("status") == "cancelled":  # noqa: PLR2004 - Google event status
        kind = ItemKind.CANCELLED_OCCURRENCE if series_id else ItemKind.REMOVED
        return ProviderEvent(kind=kind, status=EventStatus.CANCELLED, **common)

    if start is None:
        return SkippedItem(event_id, SkipReason.MISSING_START)
    try:
        span = _span(start, item.get("end"), timezone)
    except _UnreadableDateError:
        return SkippedItem(event_id, SkipReason.UNREADABLE_DATE)
    if span is None:
        return SkippedItem(event_id, SkipReason.MISSING_START)
    start_time, end_time, is_all_day = span

    recurrence = tuple(
        line.strip()
        for line in item.get("recurrence") or ()
        if isinstance(line, str) and line.strip()
    )
    if series_id:
        kind = ItemKind.OCCURRENCE
    elif recurrence:
        kind = ItemKind.MASTER
    else:
        kind = ItemKind.SINGLE

    meeting_url = _meeting_url(item)
    organizer = item.get("organizer") if isinstance(item.get("organizer"), dict) else None
    event_type = item.get("eventType")

    return ProviderEvent(
        kind=kind,
        title=fields.title(item.get("summary")),
        description=fields.description(_plain_text(item.get("description"))),
        start_time=start_time,
        end_time=end_time,
        timezone=timezone,
        is_all_day=is_all_day,
        location=fields.location(item.get("location")),
        meeting_url=meeting_url,
        has_conference=meeting_url is not None,
        status=(
            EventStatus.TENTATIVE
            if item.get("status") == "tentative"  # noqa: PLR2004 - Google event status
            else EventStatus.CONFIRMED
        ),
        visibility=(
            EventVisibility.PRIVATE
            if item.get("visibility") in _PRIVATE_VISIBILITIES
            else EventVisibility.STANDARD
        ),
        transparency=(
            EventTransparency.TRANSPARENT
            if item.get("transparency") == "transparent"  # noqa: PLR2004 - Google transparency
            else EventTransparency.OPAQUE
        ),
        recurrence=recurrence if kind == ItemKind.MASTER else (),
        attendees=_attendees(item.get("attendees")),
        organizer_email=normalize_email((organizer or {}).get("email")),
        organizer_name=fields.display_name((organizer or {}).get("displayName")),
        is_organizer=_is_organizer(organizer, self_email),
        guests_hidden=item.get("guestsCanSeeOtherGuests") is False
        and not _is_organizer(organizer, self_email),
        guest_list_hidden=item.get("guestsCanSeeOtherGuests") is False,
        is_out_of_office=event_type == "outOfOffice",  # noqa: PLR2004 - Google eventType
        is_focus_time=event_type == "focusTime",  # noqa: PLR2004 - Google eventType
        **common,
    )


def _span(start: dict[str, Any], end: Any, timezone: str) -> tuple[datetime, datetime, bool] | None:
    end = end if isinstance(end, dict) else {}
    zone = resolve_event_zone(timezone)
    if start.get("date") is not None:
        first = fields.calendar_date(start.get("date"))
        if first is None:
            raise _UnreadableDateError
        last = fields.calendar_date(end.get("date")) if end.get("date") else None
        if last is None or last <= first:
            last = first + timedelta(days=1)
        return fields.utc_midnight(first), fields.utc_midnight(last), True
    if start.get("dateTime") is not None:
        start_time = fields.instant(start.get("dateTime"), zone)
        if start_time is None:
            raise _UnreadableDateError
        end_zone = resolve_event_zone(fields.zone_name(end.get("timeZone") or timezone))
        end_time = fields.instant(end.get("dateTime"), end_zone) if end.get("dateTime") else None
        if end_time is None or end_time < start_time:
            end_time = start_time
        return start_time, end_time, False
    return None


def _original_date(value: Any, timezone: str) -> date | None:
    if not isinstance(value, dict):
        return None
    if value.get("date") is not None:
        return fields.calendar_date(value.get("date"))
    zone = resolve_event_zone(fields.zone_name(value.get("timeZone") or timezone))
    moment = fields.instant(value.get("dateTime"), zone)
    return moment.astimezone(zone).date() if moment is not None else None


def _meeting_url(item: dict[str, Any]) -> str | None:
    link = fields.web_link(item.get("hangoutLink"))
    if link:
        return link
    conference = item.get("conferenceData")
    if not isinstance(conference, dict):
        return None
    for entry in conference.get("entryPoints") or ():
        if isinstance(entry, dict) and entry.get("entryPointType") == "video":  # noqa: PLR2004 - Google entry point type
            link = fields.web_link(entry.get("uri"))
            if link:
                return link
    return None


def _attendees(raw: Any) -> tuple[ProviderAttendee, ...]:
    attendees: list[ProviderAttendee] = []
    seen: set[str] = set()
    for entry in raw or ():
        if not isinstance(entry, dict) or entry.get("resource") is True:
            continue
        email = normalize_email(entry.get("email"))
        if email is None or email in seen:
            continue
        seen.add(email)
        attendees.append(
            ProviderAttendee(
                email=email,
                display_name=fields.display_name(entry.get("displayName")),
                response=_RESPONSES.get(
                    entry.get("responseStatus") or "", ParticipantResponse.PENDING
                ),
                is_organizer=entry.get("organizer") is True,
                is_optional=entry.get("optional") is True,
                is_self=entry.get("self") is True,
            )
        )
    return tuple(attendees)


def _is_organizer(organizer: dict[str, Any] | None, self_email: str | None) -> bool:
    if organizer is None or organizer.get("self") is True:
        return True
    own = normalize_email(self_email)
    return own is not None and normalize_email(organizer.get("email")) == own


def _plain_text(value: Any) -> str:
    """Google stores descriptions edited in its web UI as HTML fragments."""
    if not isinstance(value, str) or not value:
        return ""
    if not _TAG.search(value):
        return html.unescape(value)
    text = _ANCHOR.sub(_anchor_text, value)
    text = _BREAK_TAG.sub("\n", text)
    text = _TAG.sub("", text)
    text = html.unescape(text).replace("\r\n", "\n").replace("\xa0", " ")
    return _EXTRA_BLANK_LINES.sub("\n\n", text).strip()


def _anchor_text(match: re.Match[str]) -> str:
    # The result is re-escaped because the whole fragment is unescaped once afterwards.
    link = fields.web_link(html.unescape(match.group(1)).strip())
    label = html.unescape(_TAG.sub("", match.group(2))).strip()
    if link is None or not label or label == link:
        return html.escape(link or label, quote=False)
    return html.escape(f"{label} ({link})", quote=False)
