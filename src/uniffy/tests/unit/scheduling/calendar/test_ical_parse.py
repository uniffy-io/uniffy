"""Reading calendars written by other products: what is accepted, what is
reported, and what a hostile file cannot do."""

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import EventStatus, RecurrencePattern
from uniffy.domains.scheduling.calendar.ical.parse import (
    MAX_IMPORT_BYTES,
    ImportRejection,
    parse_calendar,
)

HEADER = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
FOOTER = b"END:VCALENDAR\r\n"


def _document(*bodies: bytes) -> bytes:
    return HEADER + b"".join(bodies) + FOOTER


def _vevent(
    *,
    uid: bytes = b"a@example.com",
    summary: bytes = b"Meeting",
    extra: bytes = b"",
    dtstart: bytes = b"DTSTART:20260318T090000Z\r\n",
    dtend: bytes = b"DTEND:20260318T093000Z\r\n",
) -> bytes:
    body = b"BEGIN:VEVENT\r\n"
    if uid:
        body += b"UID:" + uid + b"\r\n"
    body += b"SUMMARY:" + summary + b"\r\n" + dtstart + dtend + extra
    return body + b"END:VEVENT\r\n"


class TestAcceptance:
    def test_a_plain_event_is_read(self) -> None:
        parsed = parse_calendar(_document(_vevent()))

        assert parsed.skipped == ()
        event = parsed.events[0]
        assert event.title == "Meeting"
        assert event.ical_uid == "a@example.com"
        assert event.recurrence_pattern is RecurrencePattern.NONE

    def test_a_missing_end_falls_back_to_duration(self) -> None:
        parsed = parse_calendar(
            _document(_vevent(dtend=b"", extra=b"DURATION:PT45M\r\n"))
        )

        event = parsed.events[0]
        assert (event.end_time - event.start_time).total_seconds() == 45 * 60

    def test_a_timed_event_with_neither_end_nor_duration_takes_no_time(self) -> None:
        parsed = parse_calendar(_document(_vevent(dtend=b"")))

        event = parsed.events[0]
        assert event.end_time == event.start_time

    def test_an_all_day_event_with_no_end_takes_one_day(self) -> None:
        parsed = parse_calendar(
            _document(_vevent(dtstart=b"DTSTART;VALUE=DATE:20260318\r\n", dtend=b""))
        )

        event = parsed.events[0]
        assert event.is_all_day
        assert (event.end_time - event.start_time).days == 1

    def test_a_floating_time_is_read_in_the_stated_zone(self) -> None:
        parsed = parse_calendar(
            _document(
                _vevent(
                    dtstart=b"DTSTART;TZID=Europe/Berlin:20260318T090000\r\n",
                    dtend=b"DTEND;TZID=Europe/Berlin:20260318T093000\r\n",
                )
            )
        )

        event = parsed.events[0]
        assert event.timezone == "Europe/Berlin"
        assert event.start_time.hour == 8  # 09:00 Berlin in March is 08:00 UTC

    def test_an_entry_with_no_summary_still_imports(self) -> None:
        parsed = parse_calendar(_document(_vevent(summary=b"")))

        assert parsed.events[0].title == "(untitled)"

    def test_a_cancelled_status_is_kept(self) -> None:
        parsed = parse_calendar(_document(_vevent(extra=b"STATUS:CANCELLED\r\n")))

        assert parsed.events[0].status is EventStatus.CANCELLED

    def test_confidential_counts_as_private(self) -> None:
        parsed = parse_calendar(_document(_vevent(extra=b"CLASS:CONFIDENTIAL\r\n")))

        assert parsed.events[0].visibility.value == "PRIVATE"


class TestReporting:
    def test_an_entry_without_a_uid_is_reported(self) -> None:
        parsed = parse_calendar(_document(_vevent(uid=b"")))

        assert parsed.events == ()
        assert parsed.skipped[0].rejection is ImportRejection.MISSING_UID
        assert parsed.skipped[0].message

    def test_an_entry_without_a_start_is_reported(self) -> None:
        parsed = parse_calendar(_document(_vevent(dtstart=b"", dtend=b"")))

        assert parsed.skipped[0].rejection is ImportRejection.MISSING_START

    def test_an_unsupported_rule_is_reported_with_its_reason(self) -> None:
        """A rule we cannot express is refused, never approximated."""
        parsed = parse_calendar(
            _document(_vevent(extra=b"RRULE:FREQ=MONTHLY;BYDAY=3TU\r\n"))
        )

        assert parsed.events == ()
        skipped = parsed.skipped[0]
        assert skipped.rejection is ImportRejection.UNSUPPORTED_RECURRENCE
        assert "third Tuesday" in skipped.message

    def test_an_occurrence_without_its_series_is_reported(self) -> None:
        parsed = parse_calendar(
            _document(
                _vevent(
                    uid=b"orphan@example.com",
                    extra=b"RECURRENCE-ID:20260325T090000Z\r\n",
                )
            )
        )

        assert parsed.events == ()
        assert parsed.skipped[0].rejection is ImportRejection.ORPHAN_OCCURRENCE

    def test_one_bad_entry_does_not_lose_the_good_ones(self) -> None:
        parsed = parse_calendar(
            _document(
                _vevent(uid=b"good@example.com", summary=b"Keep me"),
                _vevent(uid=b"", summary=b"Drop me"),
            )
        )

        assert [event.title for event in parsed.events] == ["Keep me"]
        assert len(parsed.skipped) == 1


class TestHostileInput:
    def test_a_document_that_is_not_a_calendar_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            parse_calendar(b"this is not a calendar at all")

    def test_an_oversized_payload_is_refused_before_parsing(self) -> None:
        with pytest.raises(ValidationError):
            parse_calendar(b"x" * (MAX_IMPORT_BYTES + 1))

    def test_too_many_entries_are_refused(self) -> None:
        from uniffy.domains.scheduling.calendar.ical.parse import MAX_IMPORT_EVENTS

        crowd = _document(
            *[
                _vevent(uid=f"e{index}@example.com".encode())
                for index in range(MAX_IMPORT_EVENTS + 1)
            ]
        )

        with pytest.raises(ValidationError):
            parse_calendar(crowd)

    def test_an_empty_calendar_yields_nothing_without_failing(self) -> None:
        parsed = parse_calendar(_document())

        assert parsed.events == ()
        assert parsed.skipped == ()
