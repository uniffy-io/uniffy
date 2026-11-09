"""Read a Microsoft Graph v1.0 event resource into a provider event.

Requests carry ``Prefer: outlook.timezone="UTC"`` and ``outlook.body-content-type="text"``.
"""

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

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
from uniffy.domains.scheduling.calendar.connections.recurrence import (
    UNSUPPORTED_RECURRENCE,
    graph_pattern_to_rrule,
)
from uniffy.domains.scheduling.calendar.recurrence import resolve_event_zone

_KINDS: dict[str, ItemKind] = {
    "singleInstance": ItemKind.SINGLE,
    "seriesMaster": ItemKind.MASTER,
    "occurrence": ItemKind.OCCURRENCE,
    "exception": ItemKind.OCCURRENCE,
}
_RESPONSES: dict[str, ParticipantResponse] = {
    "accepted": ParticipantResponse.ACCEPTED,
    "organizer": ParticipantResponse.ACCEPTED,
    "tentativelyAccepted": ParticipantResponse.TENTATIVE,
    "declined": ParticipantResponse.DECLINED,
    "none": ParticipantResponse.PENDING,
    "notResponded": ParticipantResponse.PENDING,
}
_PRIVATE_SENSITIVITIES = frozenset({"private", "confidential"})
_FREE_SHOW_AS = frozenset({"free", "workingElsewhere"})
# Graph reports Windows zone names for events created in Outlook desktop; the common ones only.
_WINDOWS_ZONES: dict[str, str] = {
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "W. Europe Standard Time": "Europe/Berlin",
    "Romance Standard Time": "Europe/Paris",
    "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw",
    "FLE Standard Time": "Europe/Kyiv",
    "GTB Standard Time": "Europe/Bucharest",
    "E. Europe Standard Time": "Europe/Chisinau",
    "Russian Standard Time": "Europe/Moscow",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "Pacific Standard Time": "America/Los_Angeles",
    "India Standard Time": "Asia/Kolkata",
    "China Standard Time": "Asia/Shanghai",
    "Tokyo Standard Time": "Asia/Tokyo",
    "AUS Eastern Standard Time": "Australia/Sydney",
}


def parse_graph_event(
    item: dict[str, Any], *, self_email: str | None
) -> ProviderEvent | SkippedItem:
    event_id = item.get("id")
    if not isinstance(event_id, str) or not event_id:
        return SkippedItem(provider_event_id="", reason=SkipReason.MISSING_ID)
    if item.get("@removed") is not None:
        return ProviderEvent(
            provider_event_id=event_id, kind=ItemKind.REMOVED, status=EventStatus.CANCELLED
        )

    kind = _KINDS.get(item.get("type") or "", ItemKind.SINGLE)
    timezone = graph_zone_name(item.get("originalStartTimeZone"))
    is_all_day = item.get("isAllDay") is True

    start = item.get("start")
    if not isinstance(start, dict) or not start.get("dateTime"):
        return SkippedItem(event_id, SkipReason.MISSING_START)
    start_time = _moment(start)
    if start_time is None:
        return SkippedItem(event_id, SkipReason.UNREADABLE_DATE)
    end = item.get("end")
    end_time = _moment(end) if isinstance(end, dict) else None

    if is_all_day:
        first = start_time.date()
        last = end_time.date() if end_time is not None else first
        if last <= first:
            last = first + timedelta(days=1)
        start_time, end_time = fields.utc_midnight(first), fields.utc_midnight(last)
    elif end_time is None or end_time < start_time:
        end_time = start_time

    series_id = None
    original_date = None
    if kind == ItemKind.OCCURRENCE:
        series_id = item["seriesMasterId"] if isinstance(item.get("seriesMasterId"), str) else None
        original_date = _original_date(
            item.get("originalStart"), timezone, is_all_day
        ) or _local_date(start_time, timezone, is_all_day)

    recurrence: tuple[str, ...] = ()
    if kind == ItemKind.MASTER:
        rule = graph_pattern_to_rrule(
            item.get("recurrence"), start_date=_local_date(start_time, timezone, is_all_day)
        )
        recurrence = (f"RRULE:{rule}",) if rule else (UNSUPPORTED_RECURRENCE,)

    meeting_url, has_conference = _meeting(item)
    organizer = _address(item.get("organizer"))
    show_as = item.get("showAs")

    return ProviderEvent(
        provider_event_id=event_id,
        kind=kind,
        ical_uid=fields.ical_uid(item.get("iCalUId")),
        etag=item["@odata.etag"] if isinstance(item.get("@odata.etag"), str) else None,
        updated_at=fields.instant(item.get("lastModifiedDateTime")),
        series_id=series_id,
        original_date=original_date,
        title=fields.title(item.get("subject")),
        description=fields.description(_body_text(item.get("body"))),
        start_time=start_time,
        end_time=end_time,
        timezone=timezone,
        is_all_day=is_all_day,
        location=fields.location((item.get("location") or {}).get("displayName")),
        meeting_url=meeting_url,
        has_conference=has_conference,
        status=_status(item, show_as),
        visibility=(
            EventVisibility.PRIVATE
            if item.get("sensitivity") in _PRIVATE_SENSITIVITIES
            else EventVisibility.STANDARD
        ),
        transparency=(
            EventTransparency.TRANSPARENT if show_as in _FREE_SHOW_AS else EventTransparency.OPAQUE
        ),
        recurrence=recurrence,
        attendees=_attendees(item.get("attendees"), organizer[0], self_email),
        organizer_email=organizer[0],
        organizer_name=organizer[1],
        is_organizer=item.get("isOrganizer") is not False,
        guests_hidden=item.get("hideAttendees") is True and item.get("isOrganizer") is False,
        guest_list_hidden=item.get("hideAttendees") is True,
        is_out_of_office=show_as == "oof",  # noqa: PLR2004 - Graph showAs value
    )


def _status(item: dict[str, Any], show_as: Any) -> EventStatus:
    if item.get("isCancelled") is True:
        return EventStatus.CANCELLED
    # Graph has no event status; a tentative event is pushed as showAs "tentative".
    if show_as == "tentative":  # noqa: PLR2004 - Graph showAs value
        return EventStatus.TENTATIVE
    return EventStatus.CONFIRMED


def graph_zone_name(value: Any) -> str:
    """An IANA zone for an IANA or Windows zone name, else UTC."""
    if not isinstance(value, str) or not value.strip():
        return "UTC"
    name = _WINDOWS_ZONES.get(value.strip(), value.strip())
    try:
        return ZoneInfo(name).key
    except KeyError, ValueError, OSError:
        return "UTC"


def _moment(value: dict[str, Any]) -> datetime | None:
    zone = resolve_event_zone(graph_zone_name(value.get("timeZone")))
    return fields.instant(value.get("dateTime"), zone)


def _local_date(moment: datetime, timezone: str, is_all_day: bool) -> date:
    if is_all_day:
        return moment.date()
    return moment.astimezone(resolve_event_zone(timezone)).date()


def _original_date(value: Any, timezone: str, is_all_day: bool) -> date | None:
    moment = fields.instant(value)
    if moment is None:
        return None
    # An all-day original start is either UTC midnight or local midnight shifted to UTC.
    if is_all_day and moment.time() == datetime.min.time():
        return moment.date()
    return moment.astimezone(resolve_event_zone(timezone)).date()


def _meeting(item: dict[str, Any]) -> tuple[str | None, bool]:
    online = item.get("onlineMeeting")
    join_url = fields.web_link(online.get("joinUrl")) if isinstance(online, dict) else None
    link = join_url or fields.web_link(item.get("onlineMeetingUrl"))
    return link, link is not None


def _body_text(body: Any) -> str:
    if not isinstance(body, dict) or not isinstance(body.get("content"), str):
        return ""
    return body["content"].replace("\r\n", "\n")


def _address(value: Any) -> tuple[str | None, str | None]:
    if not isinstance(value, dict) or not isinstance(value.get("emailAddress"), dict):
        return None, None
    address = value["emailAddress"]
    return normalize_email(address.get("address")), fields.display_name(address.get("name"))


def _attendees(
    raw: Any, organizer_email: str | None, self_email: str | None
) -> tuple[ProviderAttendee, ...]:
    own = normalize_email(self_email)
    attendees: list[ProviderAttendee] = []
    seen: set[str] = set()
    for entry in raw or ():
        if not isinstance(entry, dict) or entry.get("type") == "resource":  # noqa: PLR2004 - Graph attendee type
            continue
        email, name = _address(entry)
        if email is None or email in seen:
            continue
        seen.add(email)
        status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
        response = status.get("response") or ""
        attendees.append(
            ProviderAttendee(
                email=email,
                display_name=name,
                response=_RESPONSES.get(response, ParticipantResponse.PENDING),
                is_organizer=response == "organizer" or email == organizer_email,  # noqa: PLR2004 - Graph response value
                is_optional=entry.get("type") == "optional",  # noqa: PLR2004 - Graph attendee type
                is_self=own is not None and email == own,
            )
        )
    return tuple(attendees)
