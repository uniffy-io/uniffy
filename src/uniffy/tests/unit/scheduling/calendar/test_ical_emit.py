"""VCALENDAR emission: the properties external calendars key off, and the
occurrence bookkeeping that has to survive a round trip."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from dateutil.rrule import rrulestr
from icalendar import Calendar

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus, DayOfWeek
from uniffy.core.types import (
    AccessMode,
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.scheduling.calendar.recurrence import expand_recurrence
from uniffy.domains.scheduling.calendar.ical import (
    EventExport,
    IcalAttendee,
    IcalPerson,
    serialize_events,
)

BERLIN = "Europe/Berlin"


def _event(
    *,
    start: datetime,
    end: datetime,
    timezone: str = "UTC",
    title: str = "Standup",
    is_all_day: bool = False,
    pattern: RecurrencePattern = RecurrencePattern.NONE,
    config: dict | None = None,
    **overrides,
) -> CalendarEvent:
    event = CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title=title,
        start_time=start,
        end_time=end,
        timezone=timezone,
        is_all_day=is_all_day,
        access_mode=AccessMode.OWNER_ONLY,
        recurrence_pattern=pattern,
        recurrence_config=config,
        **overrides,
    )
    event.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    event.updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    return event


def _parse(payload: bytes) -> Calendar:
    return Calendar.from_ical(payload)


def _events(calendar: Calendar) -> list:
    return list(calendar.walk("VEVENT"))


def _expand(component, *, count: int) -> list[datetime]:
    """Expand the emitted rule with dateutil, which owes nothing to our expander."""
    rule = rrulestr(
        component["rrule"].to_ical().decode(),
        dtstart=component.decoded("dtstart"),
    )
    return list(rule[:count])


def _exdates(component) -> list:
    """EXDATE comes back as vDDDLists, whose values hang off ``dts``."""
    raw = component.get("exdate")
    entries = raw if isinstance(raw, list) else [raw]
    return [item.dt for entry in entries for item in entry.dts]


def _only(calendar: Calendar):
    events = _events(calendar)
    assert len(events) == 1
    return events[0]


class TestCalendarEnvelope:
    def test_carries_the_required_envelope(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            )
        )

        calendar = _parse(serialize_events([export]))

        assert calendar["prodid"].startswith("-//Uniffy//")
        assert calendar["version"] == "2.0"
        assert "method" not in calendar

    def test_method_is_stated_when_asked_for(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            )
        )

        calendar = _parse(serialize_events([export], method="REQUEST"))

        assert calendar["method"] == "REQUEST"

    def test_a_zoned_event_ships_its_timezone_definition(self) -> None:
        """Without a VTIMEZONE the recipient has to guess what the TZID means."""
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                timezone=BERLIN,
            )
        )

        calendar = _parse(serialize_events([export]))

        zones = [str(component["tzid"]) for component in calendar.walk("VTIMEZONE")]
        assert zones == [BERLIN]

    def test_an_all_day_event_needs_no_timezone_definition(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, tzinfo=UTC),
                end=datetime(2026, 3, 19, tzinfo=UTC),
                timezone=BERLIN,
                is_all_day=True,
            )
        )

        calendar = _parse(serialize_events([export]))

        assert not list(calendar.walk("VTIMEZONE"))


class TestEventProperties:
    def test_times_are_emitted_in_the_events_own_zone(self) -> None:
        """The stored instant is UTC; a recurring series has to carry the local
        wall clock or it drifts an hour at every DST boundary."""
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 8, tzinfo=UTC),
                end=datetime(2026, 3, 18, 8, 30, tzinfo=UTC),
                timezone=BERLIN,
            )
        )

        component = _only(_parse(serialize_events([export])))

        started = component.decoded("dtstart")
        assert started.astimezone(ZoneInfo(BERLIN)).hour == 9
        assert str(component["dtstart"].params["TZID"]) == BERLIN

    def test_status_transparency_and_class_travel(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                status=EventStatus.TENTATIVE,
                transparency=EventTransparency.TRANSPARENT,
                visibility=EventVisibility.PRIVATE,
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert component["status"] == "TENTATIVE"
        assert component["transp"] == "TRANSPARENT"
        assert component["class"] == "PRIVATE"

    def test_a_standard_event_states_no_class(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            )
        )

        assert "class" not in _only(_parse(serialize_events([export])))

    def test_mentions_flatten_to_their_label(self) -> None:
        """No external client speaks the in-house mention markup."""
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                description="Ping [[[Ada Lovelace|urn:uniffy:content:USER:x]]] before we start",
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert "Ada Lovelace" in str(component["description"])
        assert "urn:uniffy" not in str(component["description"])

    def test_location_and_joining_url_travel(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                location="Room 3",
                meeting_url="https://meet.example.com/abc",
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert str(component["location"]) == "Room 3"
        assert str(component["url"]) == "https://meet.example.com/abc"


class TestAllDay:
    @pytest.mark.parametrize(
        ("stored_end", "reason"),
        [
            (datetime(2026, 3, 19, tzinfo=UTC), "next-day midnight is already exclusive"),
            (datetime(2026, 3, 18, 23, 59, 59, tzinfo=UTC), "an inclusive end needs pushing past"),
        ],
    )
    def test_end_is_exclusive_whichever_way_it_was_stored(
        self, stored_end: datetime, reason: str
    ) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, tzinfo=UTC),
                end=stored_end,
                is_all_day=True,
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert component.decoded("dtstart") == date(2026, 3, 18)
        assert component.decoded("dtend") == date(2026, 3, 19), reason

    def test_dates_carry_no_time_and_no_zone(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, tzinfo=UTC),
                end=datetime(2026, 3, 19, tzinfo=UTC),
                is_all_day=True,
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert isinstance(component.decoded("dtstart"), date)
        assert not isinstance(component.decoded("dtstart"), datetime)


class TestRecurrence:
    def test_a_series_carries_its_rule(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                pattern=RecurrencePattern.WEEKLY,
                config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert component["rrule"].to_ical().decode() == "FREQ=WEEKLY;BYDAY=WE"

    def test_cancelled_occurrences_become_exdates_at_the_right_instant(self) -> None:
        """An EXDATE that does not match the occurrence DTSTART cancels nothing."""
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 8, tzinfo=UTC),
                end=datetime(2026, 3, 18, 8, 30, tzinfo=UTC),
                timezone=BERLIN,
                pattern=RecurrencePattern.WEEKLY,
                config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
            ),
            cancelled_dates=[date(2026, 3, 25)],
        )

        component = _only(_parse(serialize_events([export])))

        excluded = _exdates(component)
        assert len(excluded) == 1
        local = excluded[0].astimezone(ZoneInfo(BERLIN))
        assert local.date() == date(2026, 3, 25)
        assert local.hour == 9

    def test_an_all_day_series_excludes_bare_dates(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, tzinfo=UTC),
                end=datetime(2026, 3, 19, tzinfo=UTC),
                is_all_day=True,
                pattern=RecurrencePattern.DAILY,
                config={"interval": 1},
            ),
            cancelled_dates=[date(2026, 3, 20)],
        )

        component = _only(_parse(serialize_events([export])))

        excluded = _exdates(component)
        assert excluded == [date(2026, 3, 20)]
        assert not isinstance(excluded[0], datetime)

    def test_a_moved_occurrence_is_a_sibling_sharing_the_series_uid(self) -> None:
        master = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        )
        moved = _event(
            start=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
            title="Standup (moved)",
        )
        export = EventExport(event=master, overrides=[EventExport(event=moved)])

        components = _events(_parse(serialize_events([export])))

        assert len(components) == 2  # noqa: PLR2004
        series, override = components
        assert str(series["uid"]) == str(override["uid"])
        assert "recurrence-id" not in series
        assert override.decoded("recurrence-id").date() == date(2026, 3, 25)

    def test_a_plain_event_carries_no_rule(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            )
        )

        assert "rrule" not in _only(_parse(serialize_events([export])))


class TestDaylightSaving:
    """The acceptance criterion most likely to be quietly wrong: a weekly
    meeting must stay at its local hour when the clocks move."""

    def test_a_series_keeps_its_local_hour_across_the_spring_transition(self) -> None:
        # 09:00 Berlin is 08:00 UTC before the last Sunday in March and 07:00 after.
        event = _event(
            start=datetime(2026, 3, 18, 8, tzinfo=UTC),
            end=datetime(2026, 3, 18, 8, 30, tzinfo=UTC),
            timezone=BERLIN,
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        )
        component = _only(_parse(serialize_events([EventExport(event=event)])))

        occurrences = _expand(component, count=6)

        assert {moment.astimezone(ZoneInfo(BERLIN)).hour for moment in occurrences} == {9}
        # Proves the window actually spans the transition rather than sitting on one side.
        assert {moment.astimezone(UTC).hour for moment in occurrences} == {7, 8}

    def test_emitted_occurrences_match_the_expander(self) -> None:
        event = _event(
            start=datetime(2026, 3, 18, 8, tzinfo=UTC),
            end=datetime(2026, 3, 18, 8, 30, tzinfo=UTC),
            timezone=BERLIN,
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        )
        component = _only(_parse(serialize_events([EventExport(event=event)])))

        # One more than the window yields, so the slice below is the real comparison.
        emitted = _expand(component, count=8)
        ours = [event.start_time] + [
            occurrence.start_time
            for occurrence in expand_recurrence(
                start_time=event.start_time,
                end_time=event.end_time,
                recurrence_pattern=event.recurrence_pattern,
                recurrence_config=event.recurrence_config,
                range_start=event.start_time,
                range_end=event.start_time + timedelta(weeks=6),
                timezone=event.timezone,
            )
        ]

        assert [moment.astimezone(UTC) for moment in emitted[: len(ours)]] == [
            moment.astimezone(UTC) for moment in ours
        ]


class TestPeople:
    def test_attendees_carry_their_response_and_role(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            ),
            organizer=IcalPerson(email="ada@example.com", name="Ada Lovelace"),
            attendees=[
                IcalAttendee(
                    person=IcalPerson(email="grace@example.com", name="Grace Hopper"),
                    role=AttendeeRole.REQUIRED,
                    status=AttendeeStatus.ACCEPTED,
                ),
                IcalAttendee(
                    person=IcalPerson(email="alan@example.com"),
                    role=AttendeeRole.OPTIONAL,
                    status=AttendeeStatus.PENDING,
                ),
            ],
        )

        component = _only(_parse(serialize_events([export])))

        assert str(component["organizer"]) == "MAILTO:ada@example.com"
        first, second = component["attendee"]
        assert str(first.params["PARTSTAT"]) == "ACCEPTED"
        assert str(first.params["ROLE"]) == "REQ-PARTICIPANT"
        assert str(first.params["CN"]) == "Grace Hopper"
        assert str(second.params["PARTSTAT"]) == "NEEDS-ACTION"
        assert str(second.params["ROLE"]) == "OPT-PARTICIPANT"

    def test_an_event_with_nobody_on_it_omits_the_properties(self) -> None:
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            )
        )

        component = _only(_parse(serialize_events([export])))

        assert "organizer" not in component
        assert "attendee" not in component


class TestIdentity:
    def test_the_uid_is_stable_across_renders(self) -> None:
        event = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
        )

        first = _only(_parse(serialize_events([EventExport(event=event)])))
        second = _only(_parse(serialize_events([EventExport(event=event)])))

        assert str(first["uid"]) == str(second["uid"])
        assert str(event.id) in str(first["uid"])

    def test_output_is_byte_identical_for_unchanged_input(self) -> None:
        """A feed that re-renders differently every poll defeats conditional GET."""
        export = EventExport(
            event=_event(
                start=datetime(2026, 3, 18, 9, tzinfo=UTC),
                end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
                timezone=BERLIN,
            )
        )

        assert serialize_events([export]) == serialize_events([export])

    def test_several_events_render_into_one_document(self) -> None:
        exports = [
            EventExport(
                event=_event(
                    start=datetime(2026, 3, 18, 9, tzinfo=UTC) + timedelta(days=offset),
                    end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC) + timedelta(days=offset),
                )
            )
            for offset in range(3)
        ]

        assert len(_events(_parse(serialize_events(exports)))) == 3  # noqa: PLR2004


class TestMovedOccurrence:
    def test_the_recurrence_id_names_the_occurrence_being_replaced(self) -> None:
        """A client matches an override to its series by RECURRENCE-ID, so a
        meeting dragged to another day still has to point at the day it left."""
        master = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        )
        moved = _event(
            start=datetime(2026, 3, 27, 14, tzinfo=UTC),
            end=datetime(2026, 3, 27, 14, 30, tzinfo=UTC),
            title="Standup (moved)",
        )
        export = EventExport(
            event=master,
            overrides=[EventExport(event=moved, original_date=date(2026, 3, 25))],
        )

        _, override = _events(_parse(serialize_events([export])))

        assert override.decoded("recurrence-id").date() == date(2026, 3, 25)
        assert override.decoded("dtstart").date() == date(2026, 3, 27)

    def test_an_all_day_series_names_the_original_date(self) -> None:
        master = _event(
            start=datetime(2026, 3, 18, tzinfo=UTC),
            end=datetime(2026, 3, 19, tzinfo=UTC),
            is_all_day=True,
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        )
        moved = _event(
            start=datetime(2026, 3, 27, tzinfo=UTC),
            end=datetime(2026, 3, 28, tzinfo=UTC),
            is_all_day=True,
        )
        export = EventExport(
            event=master,
            overrides=[EventExport(event=moved, original_date=date(2026, 3, 25))],
        )

        _, override = _events(_parse(serialize_events([export])))

        assert override.decoded("recurrence-id") == date(2026, 3, 25)


class TestImportedIdentity:
    def test_an_imported_event_keeps_the_uid_it_arrived_with(self) -> None:
        """Exporting and importing back has to match the event already here
        rather than create a second copy of it."""
        event = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            ical_uid="outside-uid@example.com",
        )

        component = _only(_parse(serialize_events([EventExport(event=event)])))

        assert str(component["uid"]) == "outside-uid@example.com"

    def test_an_override_carries_the_series_uid_it_belongs_to(self) -> None:
        master = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
            ical_uid="series-uid@example.com",
        )
        moved = _event(
            start=datetime(2026, 3, 25, 14, tzinfo=UTC),
            end=datetime(2026, 3, 25, 14, 30, tzinfo=UTC),
            ical_uid="ignored-override-uid@example.com",
        )
        export = EventExport(event=master, overrides=[EventExport(event=moved)])

        series, override = _events(_parse(serialize_events([export])))

        assert str(series["uid"]) == "series-uid@example.com"
        assert str(override["uid"]) == "series-uid@example.com"


class TestPrivateDetail:
    @staticmethod
    def _hidden_component():
        event = _event(
            start=datetime(2026, 3, 18, 9, tzinfo=UTC),
            end=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
            title="Offer negotiation",
            description="Salary band",
            location="Room 4",
            meeting_url="https://meet.example.com/abc",
            visibility=EventVisibility.PRIVATE,
        )
        export = EventExport(
            event=event,
            organizer=IcalPerson(email="ada@example.com", name="Ada Lovelace"),
            attendees=[IcalAttendee(person=IcalPerson(email="grace@example.com"))],
            details_hidden=True,
        )
        return _only(_parse(serialize_events([export])))

    def test_it_says_only_that_the_time_is_taken(self) -> None:
        component = self._hidden_component()

        assert str(component["summary"]) == "Busy"
        assert "description" not in component
        assert "location" not in component
        assert "url" not in component

    def test_it_names_nobody_on_the_meeting(self) -> None:
        component = self._hidden_component()

        assert "attendee" not in component

    def test_it_stays_honest_about_when(self) -> None:
        """The whole point of publishing it at all is that the time is taken."""
        component = self._hidden_component()

        assert component.decoded("dtstart") == datetime(2026, 3, 18, 9, tzinfo=UTC)
        assert str(component["class"]) == "PRIVATE"
