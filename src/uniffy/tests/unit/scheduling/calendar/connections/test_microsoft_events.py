"""Microsoft Graph v1.0 event resources read into provider events."""

from datetime import UTC, date, datetime
from typing import Any

from uniffy.core.models.calendar.participant import ParticipantResponse
from uniffy.core.types import EventStatus, EventTransparency, EventVisibility
from uniffy.domains.scheduling.calendar.connections.normalize import (
    ItemKind,
    ProviderEvent,
    SkippedItem,
    SkipReason,
)
from uniffy.domains.scheduling.calendar.connections.providers.microsoft_events import (
    graph_zone_name,
    parse_graph_event,
)
from uniffy.domains.scheduling.calendar.connections.recurrence import UNSUPPORTED_RECURRENCE

SELF = "maria@contoso.com"
MASTER_ID = "AAMkAGI2TGuLAAA="


def _event(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "@odata.etag": 'W/"DwAAABYAAABBX2aTlmGqT6xDFn8ULdA7AAAWwYZw"',
        "id": "AAMkAGI2THVSAAA=",
        "createdDateTime": "2026-11-01T08:12:44.1234567Z",
        "lastModifiedDateTime": "2026-11-02T10:30:15.5123456Z",
        "changeKey": "DwAAABYAAABBX2aTlmGqT6xDFn8ULdA7AAAWwYZw",
        "categories": [],
        "originalStartTimeZone": "FLE Standard Time",
        "originalEndTimeZone": "FLE Standard Time",
        "iCalUId": "040000008200E00074C5B7101A82E00800000000D0BEF1E7F7D9DC010000000000000000100000004A",
        "reminderMinutesBeforeStart": 15,
        "isReminderOn": True,
        "hasAttachments": False,
        "subject": "Weekly planning",
        "bodyPreview": "Agenda",
        "importance": "normal",
        "sensitivity": "normal",
        "isAllDay": False,
        "isCancelled": False,
        "isOrganizer": True,
        "responseRequested": True,
        "seriesMasterId": None,
        "showAs": "busy",
        "type": "singleInstance",
        "webLink": "https://outlook.office365.com/owa/?itemid=AAMkAGI2THVSAAA%3D",
        "onlineMeetingUrl": None,
        "isOnlineMeeting": False,
        "onlineMeetingProvider": "unknown",
        "responseStatus": {"response": "organizer", "time": "0001-01-01T00:00:00Z"},
        "body": {"contentType": "text", "content": "Agenda\r\n1. Roadmap"},
        "start": {"dateTime": "2026-11-10T07:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-11-10T08:00:00.0000000", "timeZone": "UTC"},
        "location": {
            "displayName": "Room Vitosha",
            "locationType": "default",
            "uniqueIdType": "unknown",
        },
        "locations": [],
        "recurrence": None,
        "attendees": [],
        "organizer": {"emailAddress": {"name": "Maria Ivanova", "address": "Maria@Contoso.com"}},
        "onlineMeeting": None,
    }
    item.update(overrides)
    return item


def _parse(item: dict[str, Any], self_email: str | None = SELF) -> ProviderEvent:
    parsed = parse_graph_event(item, self_email=self_email)
    assert isinstance(parsed, ProviderEvent)
    return parsed


def test_timed_single_instance() -> None:
    event = _parse(_event())

    assert event.kind == ItemKind.SINGLE
    assert event.start_time == datetime(2026, 11, 10, 7, tzinfo=UTC)
    assert event.end_time == datetime(2026, 11, 10, 8, tzinfo=UTC)
    assert event.timezone == "Europe/Kyiv"
    assert event.title == "Weekly planning"
    assert event.description == "Agenda\n1. Roadmap"
    assert event.location == "Room Vitosha"
    assert event.etag == 'W/"DwAAABYAAABBX2aTlmGqT6xDFn8ULdA7AAAWwYZw"'
    assert event.updated_at == datetime(2026, 11, 2, 10, 30, 15, 512345, tzinfo=UTC)
    assert event.ical_uid is not None
    assert event.ical_uid.startswith("040000008200E00074C5B7101A82E008")
    assert event.organizer_email == SELF
    assert event.organizer_name == "Maria Ivanova"
    assert event.is_organizer
    assert event.status == EventStatus.CONFIRMED
    assert event.transparency == EventTransparency.OPAQUE


def test_series_master_maps_its_pattern() -> None:
    event = _parse(
        _event(
            type="seriesMaster",
            originalStartTimeZone="Europe/Sofia",
            recurrence={
                "pattern": {
                    "type": "weekly",
                    "interval": 1,
                    "month": 0,
                    "dayOfMonth": 0,
                    "daysOfWeek": ["tuesday"],
                    "firstDayOfWeek": "sunday",
                    "index": "first",
                },
                "range": {
                    "type": "noEnd",
                    "startDate": "2026-11-10",
                    "endDate": "0001-01-01",
                    "recurrenceTimeZone": "UTC",
                    "numberOfOccurrences": 0,
                },
            },
        )
    )

    assert event.kind == ItemKind.MASTER
    assert event.timezone == "Europe/Sofia"
    assert event.recurrence == ("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU",)


def test_series_master_with_unsupported_pattern() -> None:
    event = _parse(
        _event(
            type="seriesMaster",
            recurrence={
                "pattern": {
                    "type": "relativeMonthly",
                    "interval": 1,
                    "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"],
                    "index": "last",
                },
                "range": {"type": "noEnd", "startDate": "2026-11-30"},
            },
        )
    )

    assert event.recurrence == (UNSUPPORTED_RECURRENCE,)


def test_removed_in_delta() -> None:
    event = _parse({
        "@odata.type": "#microsoft.graph.event",
        "id": "AAMkAGI2THVSAAA=",
        "@removed": {"reason": "deleted"},
    })

    assert event.kind == ItemKind.REMOVED


def test_exception_occurrence() -> None:
    event = _parse(
        _event(
            id="AAMkAGI2TGuLBBB=",
            type="exception",
            seriesMasterId=MASTER_ID,
            originalStart="2026-11-24T07:00:00Z",
            originalStartTimeZone="Europe/Sofia",
            start={"dateTime": "2026-11-25T08:00:00.0000000", "timeZone": "UTC"},
            end={"dateTime": "2026-11-25T09:00:00.0000000", "timeZone": "UTC"},
        )
    )

    assert event.kind == ItemKind.OCCURRENCE
    assert event.series_id == MASTER_ID
    assert event.original_date == date(2026, 11, 24)
    assert event.start_time == datetime(2026, 11, 25, 8, tzinfo=UTC)


def test_plain_occurrence_falls_back_to_its_start_date() -> None:
    event = _parse(
        _event(
            type="occurrence",
            seriesMasterId=MASTER_ID,
            originalStartTimeZone="Europe/Sofia",
            start={"dateTime": "2026-11-16T22:30:00.0000000", "timeZone": "UTC"},
            end={"dateTime": "2026-11-16T23:30:00.0000000", "timeZone": "UTC"},
        )
    )

    assert event.original_date == date(2026, 11, 17)


def test_cancelled_occurrence_keeps_its_row() -> None:
    event = _parse(
        _event(
            type="occurrence",
            seriesMasterId=MASTER_ID,
            isCancelled=True,
            originalStart="2026-11-17T07:00:00Z",
        )
    )

    assert event.kind == ItemKind.OCCURRENCE
    assert event.status == EventStatus.CANCELLED


def test_all_day() -> None:
    event = _parse(
        _event(
            isAllDay=True,
            start={"dateTime": "2026-11-12T00:00:00.0000000", "timeZone": "UTC"},
            end={"dateTime": "2026-11-14T00:00:00.0000000", "timeZone": "UTC"},
        )
    )

    assert event.is_all_day
    assert event.start_time == datetime(2026, 11, 12, tzinfo=UTC)
    assert event.end_time == datetime(2026, 11, 14, tzinfo=UTC)


def test_start_in_windows_zone() -> None:
    event = _parse(
        _event(
            start={"dateTime": "2026-11-10T09:00:00.0000000", "timeZone": "Pacific Standard Time"}
        )
    )

    assert event.start_time == datetime(2026, 11, 10, 17, tzinfo=UTC)


def test_show_as_and_sensitivity() -> None:
    free = _parse(_event(showAs="free", sensitivity="private"))
    elsewhere = _parse(_event(showAs="workingElsewhere"))
    away = _parse(_event(showAs="oof"))
    tentative = _parse(_event(showAs="tentative"))

    assert tentative.status == EventStatus.TENTATIVE
    assert tentative.transparency == EventTransparency.OPAQUE
    assert free.status == EventStatus.CONFIRMED
    assert free.transparency == EventTransparency.TRANSPARENT
    assert free.visibility == EventVisibility.PRIVATE
    assert elsewhere.transparency == EventTransparency.TRANSPARENT
    assert away.is_out_of_office
    assert away.transparency == EventTransparency.OPAQUE


def test_teams_link_and_join_line() -> None:
    join = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0"
    event = _parse(
        _event(
            isOnlineMeeting=True,
            onlineMeetingProvider="teamsForBusiness",
            onlineMeeting={"joinUrl": join},
            body={
                "contentType": "text",
                "content": "Agenda\r\n\r\nJoin: https://app.uniffy.io/calls/room-42\r\n",
            },
        )
    )

    assert event.meeting_url == join
    assert event.has_conference
    assert event.description == "Agenda"


def test_attendees_map_and_skip_resources() -> None:
    event = _parse(
        _event(
            isOrganizer=False,
            organizer={"emailAddress": {"name": "Boss", "address": "boss@partner.org"}},
            attendees=[
                {
                    "type": "required",
                    "status": {"response": "organizer", "time": "0001-01-01T00:00:00Z"},
                    "emailAddress": {"name": "Boss", "address": "boss@partner.org"},
                },
                {
                    "type": "required",
                    "status": {"response": "tentativelyAccepted", "time": "2026-11-03T09:00:00Z"},
                    "emailAddress": {"name": "Maria Ivanova", "address": "maria@contoso.com"},
                },
                {
                    "type": "optional",
                    "status": {"response": "declined", "time": "2026-11-03T09:00:00Z"},
                    "emailAddress": {"name": "Ana", "address": "ana@contoso.com"},
                },
                {
                    "type": "required",
                    "status": {"response": "none", "time": "0001-01-01T00:00:00Z"},
                    "emailAddress": {"name": "Ivan", "address": "ivan@contoso.com"},
                },
                {
                    "type": "resource",
                    "status": {"response": "accepted", "time": "2026-11-03T09:00:00Z"},
                    "emailAddress": {"name": "Room Vitosha", "address": "vitosha@contoso.com"},
                },
            ],
        )
    )

    by_email = {attendee.email: attendee for attendee in event.attendees}
    assert set(by_email) == {
        "boss@partner.org",
        "maria@contoso.com",
        "ana@contoso.com",
        "ivan@contoso.com",
    }
    assert not event.is_organizer
    assert by_email["boss@partner.org"].is_organizer
    assert by_email["boss@partner.org"].response == ParticipantResponse.ACCEPTED
    assert by_email["maria@contoso.com"].response == ParticipantResponse.TENTATIVE
    assert by_email["maria@contoso.com"].is_self
    assert by_email["ana@contoso.com"].is_optional
    assert by_email["ana@contoso.com"].response == ParticipantResponse.DECLINED
    assert by_email["ivan@contoso.com"].response == ParticipantResponse.PENDING


def test_skips() -> None:
    no_id = parse_graph_event(_event(id=None), self_email=SELF)
    no_start = parse_graph_event(_event(start=None), self_email=SELF)
    bad_start = parse_graph_event(
        _event(start={"dateTime": "soon", "timeZone": "UTC"}), self_email=SELF
    )

    assert no_id == SkippedItem("", SkipReason.MISSING_ID)
    assert isinstance(no_start, SkippedItem)
    assert no_start.reason == SkipReason.MISSING_START
    assert isinstance(bad_start, SkippedItem)
    assert bad_start.reason == SkipReason.UNREADABLE_DATE


def test_zone_names() -> None:
    assert graph_zone_name("Europe/Sofia") == "Europe/Sofia"
    assert graph_zone_name("Eastern Standard Time") == "America/New_York"
    assert graph_zone_name("tzone://Microsoft/Custom") == "UTC"
    assert graph_zone_name(None) == "UTC"
