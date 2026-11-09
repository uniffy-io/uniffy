"""Google Calendar v3 event resources read into provider events."""

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
from uniffy.domains.scheduling.calendar.connections.providers.google_events import (
    parse_google_event,
)

SELF = "maria@example.com"


def _event(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "kind": "calendar#event",
        "etag": '"3456789012345678"',
        "id": "7k2m9q4r1s8t3u6v0w5x",
        "status": "confirmed",
        "htmlLink": "https://www.google.com/calendar/event?eid=N2syaTlxNHIxczh0",
        "created": "2026-11-01T08:12:44.000Z",
        "updated": "2026-11-02T10:30:15.512Z",
        "summary": "Weekly planning",
        "creator": {"email": SELF, "self": True},
        "organizer": {"email": SELF, "displayName": "Maria Ivanova", "self": True},
        "start": {"dateTime": "2026-11-10T09:00:00+02:00", "timeZone": "Europe/Sofia"},
        "end": {"dateTime": "2026-11-10T10:00:00+02:00", "timeZone": "Europe/Sofia"},
        "iCalUID": "7k2m9q4r1s8t3u6v0w5x@google.com",
        "sequence": 2,
        "reminders": {"useDefault": True},
        "eventType": "default",
    }
    item.update(overrides)
    return item


def _parse(item: dict[str, Any], self_email: str | None = SELF) -> ProviderEvent:
    parsed = parse_google_event(item, self_email=self_email)
    assert isinstance(parsed, ProviderEvent)
    return parsed


def test_timed_single_event() -> None:
    event = _parse(_event())

    assert event.kind == ItemKind.SINGLE
    assert event.provider_event_id == "7k2m9q4r1s8t3u6v0w5x"
    assert event.start_time == datetime(2026, 11, 10, 7, tzinfo=UTC)
    assert event.end_time == datetime(2026, 11, 10, 8, tzinfo=UTC)
    assert event.timezone == "Europe/Sofia"
    assert not event.is_all_day
    assert event.title == "Weekly planning"
    assert event.etag == '"3456789012345678"'
    assert event.updated_at == datetime(2026, 11, 2, 10, 30, 15, 512000, tzinfo=UTC)
    assert event.sequence == 2
    assert event.ical_uid == "7k2m9q4r1s8t3u6v0w5x@google.com"
    assert event.status == EventStatus.CONFIRMED
    assert event.visibility == EventVisibility.STANDARD
    assert event.transparency == EventTransparency.OPAQUE
    assert event.is_organizer
    assert event.organizer_email == SELF
    assert event.organizer_name == "Maria Ivanova"
    assert event.recurrence == ()


def test_master_keeps_rule_lines_verbatim() -> None:
    event = _parse(
        _event(recurrence=["RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE;TZID=Europe/Sofia:20261124T090000"])
    )

    assert event.kind == ItemKind.MASTER
    assert event.recurrence == (
        "RRULE:FREQ=WEEKLY;BYDAY=TU",
        "EXDATE;TZID=Europe/Sofia:20261124T090000",
    )


def test_all_day_single_day() -> None:
    event = _parse(_event(start={"date": "2026-11-12"}, end={"date": "2026-11-13"}))

    assert event.is_all_day
    assert event.start_time == datetime(2026, 11, 12, tzinfo=UTC)
    assert event.end_time == datetime(2026, 11, 13, tzinfo=UTC)
    assert event.timezone == "UTC"


def test_all_day_two_days() -> None:
    event = _parse(_event(start={"date": "2026-11-12"}, end={"date": "2026-11-14"}))

    assert event.start_time == datetime(2026, 11, 12, tzinfo=UTC)
    assert event.end_time == datetime(2026, 11, 14, tzinfo=UTC)


def test_all_day_end_not_after_start_spans_one_day() -> None:
    event = _parse(_event(start={"date": "2026-11-12"}, end={"date": "2026-11-12"}))

    assert event.end_time == datetime(2026, 11, 13, tzinfo=UTC)


def test_missing_end_defaults() -> None:
    timed = _parse(_event(end=None))
    all_day = _parse(_event(start={"date": "2026-11-12"}, end=None))

    assert timed.end_time == timed.start_time
    assert all_day.end_time == datetime(2026, 11, 13, tzinfo=UTC)


def test_cancelled_single_is_removed() -> None:
    event = _parse({
        "kind": "calendar#event",
        "etag": '"3456789012345999"',
        "id": "7k2m9q4r1s8t3u6v0w5x",
        "status": "cancelled",
    })

    assert event.kind == ItemKind.REMOVED
    assert event.status == EventStatus.CANCELLED


def test_cancelled_occurrence() -> None:
    event = _parse({
        "kind": "calendar#event",
        "etag": '"3456789012346000"',
        "id": "7k2m9q4r1s8t3u6v0w5x_20261117T070000Z",
        "status": "cancelled",
        "recurringEventId": "7k2m9q4r1s8t3u6v0w5x",
        "originalStartTime": {
            "dateTime": "2026-11-17T09:00:00+02:00",
            "timeZone": "Europe/Sofia",
        },
    })

    assert event.kind == ItemKind.CANCELLED_OCCURRENCE
    assert event.series_id == "7k2m9q4r1s8t3u6v0w5x"
    assert event.original_date == date(2026, 11, 17)


def test_original_date_uses_the_event_zone() -> None:
    # 23:30 UTC on the 16th is already the 17th in Sofia.
    event = _parse({
        "id": "late_20261116T233000Z",
        "status": "cancelled",
        "recurringEventId": "late",
        "originalStartTime": {"dateTime": "2026-11-16T23:30:00Z", "timeZone": "Europe/Sofia"},
    })

    assert event.original_date == date(2026, 11, 17)


def test_moved_occurrence() -> None:
    event = _parse(
        _event(
            id="7k2m9q4r1s8t3u6v0w5x_20261124T070000Z",
            recurringEventId="7k2m9q4r1s8t3u6v0w5x",
            originalStartTime={
                "dateTime": "2026-11-24T09:00:00+02:00",
                "timeZone": "Europe/Sofia",
            },
            start={"dateTime": "2026-11-25T10:00:00+02:00", "timeZone": "Europe/Sofia"},
            end={"dateTime": "2026-11-25T11:00:00+02:00", "timeZone": "Europe/Sofia"},
        )
    )

    assert event.kind == ItemKind.OCCURRENCE
    assert event.series_id == "7k2m9q4r1s8t3u6v0w5x"
    assert event.original_date == date(2026, 11, 24)
    assert event.start_time == datetime(2026, 11, 25, 8, tzinfo=UTC)


def test_all_day_occurrence_original_date() -> None:
    event = _parse(
        _event(
            recurringEventId="series",
            originalStartTime={"date": "2026-11-12"},
            start={"date": "2026-11-13"},
            end={"date": "2026-11-14"},
        )
    )

    assert event.original_date == date(2026, 11, 12)


def test_private_transparent_tentative() -> None:
    event = _parse(_event(visibility="confidential", transparency="transparent", status="tentative"))

    assert event.visibility == EventVisibility.PRIVATE
    assert event.transparency == EventTransparency.TRANSPARENT
    assert event.status == EventStatus.TENTATIVE


def test_meet_link_from_conference_data() -> None:
    event = _parse(
        _event(
            conferenceData={
                "entryPoints": [
                    {
                        "entryPointType": "phone",
                        "uri": "tel:+1-555-0100",
                        "label": "+1 555-0100",
                        "pin": "123456",
                    },
                    {
                        "entryPointType": "video",
                        "uri": "https://meet.google.com/abc-defg-hij",
                        "label": "meet.google.com/abc-defg-hij",
                    },
                ],
                "conferenceSolution": {"key": {"type": "hangoutsMeet"}, "name": "Google Meet"},
                "conferenceId": "abc-defg-hij",
            }
        )
    )

    assert event.meeting_url == "https://meet.google.com/abc-defg-hij"
    assert event.has_conference


def test_hangout_link_wins_and_unsafe_links_are_dropped() -> None:
    linked = _parse(_event(hangoutLink="https://meet.google.com/xyz-abcd-efg"))
    unsafe = _parse(_event(hangoutLink="javascript:alert(1)"))

    assert linked.meeting_url == "https://meet.google.com/xyz-abcd-efg"
    assert unsafe.meeting_url is None
    assert not unsafe.has_conference


def test_html_description_becomes_plain_text_without_join_line() -> None:
    event = _parse(
        _event(
            description=(
                "<b>Agenda</b><br>1. Roadmap &amp; risks<br><br><br><br>"
                '<a href="https://docs.example.com/plan">Plan doc</a><br>'
                "<ul><li>One</li><li>Two</li></ul>"
                "Join: https://app.uniffy.io/calls/room-42"
            )
        )
    )

    assert event.description == (
        "Agenda\n1. Roadmap & risks\n\nPlan doc (https://docs.example.com/plan)\n\nOne\nTwo"
    )


def test_plain_description_keeps_angle_brackets() -> None:
    event = _parse(_event(description="Budget < 5k and > 2k\nJoin: https://app.uniffy.io/x"))

    assert event.description == "Budget < 5k and > 2k"


def test_description_neutralizes_mentions() -> None:
    event = _parse(_event(description="See [[[Secret|urn:uniffy:content:NOTE:abc]]]"))

    assert event.description == "See Secret"


def test_attendees_map_and_skip_rooms() -> None:
    event = _parse(
        _event(
            attendees=[
                {
                    "email": SELF,
                    "displayName": "Maria Ivanova",
                    "organizer": True,
                    "self": True,
                    "responseStatus": "accepted",
                },
                {"email": " Georgi@Example.COM ", "responseStatus": "tentative", "optional": True},
                {"email": "ana@partner.org", "responseStatus": "declined"},
                {"email": "ivan@partner.org", "responseStatus": "needsAction"},
                {
                    "email": "c_1888abc@resource.calendar.google.com",
                    "displayName": "Room Vitosha",
                    "resource": True,
                    "responseStatus": "accepted",
                },
                {"displayName": "No address", "responseStatus": "accepted"},
            ]
        )
    )

    by_email = {attendee.email: attendee for attendee in event.attendees}
    assert set(by_email) == {SELF, "georgi@example.com", "ana@partner.org", "ivan@partner.org"}
    assert by_email[SELF].is_organizer
    assert by_email[SELF].is_self
    assert by_email[SELF].response == ParticipantResponse.ACCEPTED
    assert by_email["georgi@example.com"].response == ParticipantResponse.TENTATIVE
    assert by_email["georgi@example.com"].is_optional
    assert by_email["ana@partner.org"].response == ParticipantResponse.DECLINED
    assert by_email["ivan@partner.org"].response == ParticipantResponse.PENDING


def test_organizer_detection() -> None:
    other = {"email": "boss@partner.org", "displayName": "Boss"}
    assert not _parse(_event(organizer=other)).is_organizer
    assert _parse(_event(organizer={"email": "MARIA@example.com"})).is_organizer
    assert _parse(_event(organizer=None)).is_organizer
    assert not _parse(_event(organizer=other), self_email=None).is_organizer


def test_event_types() -> None:
    assert _parse(_event(eventType="outOfOffice")).is_out_of_office
    assert _parse(_event(eventType="focusTime")).is_focus_time
    working = _parse(_event(eventType="workingLocation"))
    assert not working.is_out_of_office
    assert not working.is_focus_time


def test_skips() -> None:
    no_id = parse_google_event(_event(id=None), self_email=SELF)
    no_start = parse_google_event(_event(start=None), self_email=SELF)
    bad_start = parse_google_event(_event(start={"dateTime": "next tuesday"}), self_email=SELF)
    bad_date = parse_google_event(_event(start={"date": "2026-13-45"}), self_email=SELF)

    assert no_id == SkippedItem("", SkipReason.MISSING_ID)
    assert isinstance(no_start, SkippedItem)
    assert no_start.reason == SkipReason.MISSING_START
    assert isinstance(bad_start, SkippedItem)
    assert bad_start.reason == SkipReason.UNREADABLE_DATE
    assert isinstance(bad_date, SkippedItem)
    assert bad_date.reason == SkipReason.UNREADABLE_DATE


def test_uid_with_controls_is_dropped_and_text_is_capped() -> None:
    event = _parse(_event(iCalUID="bad\x00uid@google.com", summary="x" * 900, location="y" * 900))

    assert event.ical_uid is None
    assert len(event.title) == 500
    assert len(event.location) == 500
