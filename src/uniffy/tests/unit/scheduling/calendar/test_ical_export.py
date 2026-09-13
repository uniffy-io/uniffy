"""Assembling a VCALENDAR from stored rows: what becomes an EXDATE, what
becomes a moved occurrence, and how many queries it costs."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from icalendar import Calendar

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus, DayOfWeek
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    EventVisibility,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.permissions.access import ResourceKey
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.ical.emit import serialize_events
from uniffy.domains.scheduling.calendar.rpc.interop import _filename

VIEWER = generate_id()
ORG = generate_id()


class _Scalars(list):
    def all(self) -> list:
        return list(self)


def _scalars(rows: list) -> MagicMock:
    return MagicMock(scalars=MagicMock(return_value=_Scalars(rows)))


def _rows(rows: list) -> MagicMock:
    return MagicMock(all=MagicMock(return_value=rows))


def _series(**overrides) -> CalendarEvent:
    event = CalendarEvent(
        organization_id=ORG,
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Standup",
        start_time=datetime(2026, 3, 18, 9, tzinfo=UTC),
        end_time=datetime(2026, 3, 18, 9, 30, tzinfo=UTC),
        access_mode=AccessMode.OWNER_ONLY,
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_config={"interval": 1, "days_of_week": [DayOfWeek.WEDNESDAY.value]},
        **overrides,
    )
    event.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    event.updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    return event


def _override_of(master: CalendarEvent, when: datetime) -> CalendarEvent:
    moved = CalendarEvent(
        organization_id=master.organization_id,
        organizer_id=master.organizer_id,
        calendar_id=master.calendar_id,
        title="Standup (moved)",
        start_time=when,
        end_time=when,
        access_mode=AccessMode.OWNER_ONLY,
        recurrence_id=master.id,
    )
    moved.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    moved.updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    return moved


def _exception(event_id, original: date, *, cancelled: bool, override_id=None) -> RecurrenceException:
    return RecurrenceException(
        event_id=event_id,
        original_date=original,
        is_cancelled=cancelled,
        override_event_id=override_id,
    )


def _session(*, exceptions=(), overrides=(), attendees=(), users=()) -> MagicMock:
    """build_exports reads exceptions, overrides, attendees, then organizers."""
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _scalars(list(exceptions)),
            _scalars(list(overrides)),
            _rows(list(attendees)),
            _scalars(list(users)),
        ]
    )
    return session


class TestAssembly:
    async def test_a_cancelled_occurrence_becomes_an_exdate(self) -> None:
        master = _series()
        session = _session(
            exceptions=[_exception(master.id, date(2026, 3, 25), cancelled=True)]
        )

        exports = await build_exports(
            session,
            [master],
            viewer_id=VIEWER,
            organization_id=ORG,
        )

        assert list(exports[0].cancelled_dates) == [date(2026, 3, 25)]

    async def test_a_moved_occurrence_is_not_also_an_exdate(self) -> None:
        """The exception row carries both flags; emitting EXDATE alongside the
        RECURRENCE-ID sibling would delete the occurrence that was moved.
        """
        master = _series()
        moved = _override_of(master, datetime(2026, 3, 25, 14, tzinfo=UTC))
        session = _session(
            exceptions=[
                _exception(master.id, date(2026, 3, 25), cancelled=True, override_id=moved.id)
            ],
            overrides=[moved],
        )

        exports = await build_exports(
            session,
            [master],
            viewer_id=VIEWER,
            organization_id=ORG,
        )

        assert list(exports[0].cancelled_dates) == []
        assert [export.event.id for export in exports[0].overrides] == [moved.id]

    async def test_an_override_is_not_emitted_as_its_own_series(self) -> None:
        """list_events returns override rows too; they belong under their master."""
        master = _series()
        moved = _override_of(master, datetime(2026, 3, 25, 14, tzinfo=UTC))
        session = _session(overrides=[moved])

        exports = await build_exports(
            session,
            [master, moved],
            viewer_id=VIEWER,
            organization_id=ORG,
        )

        assert len(exports) == 1
        assert exports[0].event.id == master.id

    async def test_attendees_and_organizer_are_attached(self) -> None:
        master = _series()
        organizer = User(
            id=master.organizer_id,
            email="ada@example.com",
            username="ada",
            full_name="Ada Lovelace",
        )
        guest_id = generate_id()
        guest = User(
            id=guest_id,
            email="grace@example.com",
            username="grace",
            full_name="Grace Hopper",
        )
        attendee = EventAttendee(
            event_id=master.id,
            user_id=guest_id,
            role=AttendeeRole.OPTIONAL,
            status=AttendeeStatus.ACCEPTED,
        )
        session = _session(attendees=[(attendee, guest)], users=[organizer])

        exports = await build_exports(
            session,
            [master],
            viewer_id=VIEWER,
            organization_id=ORG,
        )

        assert exports[0].organizer.email == "ada@example.com"
        assert exports[0].attendees[0].person.name == "Grace Hopper"
        assert exports[0].attendees[0].status is AttendeeStatus.ACCEPTED

    async def test_assembly_costs_a_fixed_number_of_queries(self) -> None:
        """A calendar export must not read per event."""
        events = [_series() for _ in range(25)]
        session = _session()

        await build_exports(
            session,
            events,
            viewer_id=VIEWER,
            organization_id=ORG,
        )

        assert session.execute.await_count == 4  # noqa: PLR2004

    async def test_nothing_to_export_reads_nothing(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock()

        assert await build_exports(
            session,
            [],
            viewer_id=VIEWER,
            organization_id=ORG,
        ) == []
        session.execute.assert_not_awaited()

    async def test_assembled_series_serializes_with_its_exclusions(self) -> None:
        master = _series()
        session = _session(
            exceptions=[_exception(master.id, date(2026, 3, 25), cancelled=True)]
        )

        exports = await build_exports(
            session,
            [master],
            viewer_id=VIEWER,
            organization_id=ORG,
        )
        component = next(iter(Calendar.from_ical(serialize_events(exports)).walk("VEVENT")))

        assert "rrule" in component
        assert "exdate" in component


class TestPrivateEvents:
    """A private event a viewer is not on publishes as a busy block; the
    export path owes the same redaction the app applies on every other read."""

    @staticmethod
    def _resolver(role: ContentRole | None):
        resolved = MagicMock()
        resolved.resolve_page = AsyncMock(
            side_effect=lambda **kwargs: {
                key: MagicMock(role=role) for key in kwargs["keys"]
            }
        )
        return patch(
            "uniffy.domains.scheduling.calendar.ical.assemble.ResourceAccessResolver",
            return_value=resolved,
        )

    async def _hidden(self, *, role=None, attendees=(), users=()) -> bool:
        master = _series(visibility=EventVisibility.PRIVATE)
        session = _session(attendees=list(attendees), users=list(users))

        with self._resolver(role):
            exports = await build_exports(
                session,
                [master],
                viewer_id=VIEWER,
                organization_id=ORG,
            )
        return exports[0].details_hidden

    async def test_a_bystander_sees_only_that_the_time_is_taken(self) -> None:
        assert await self._hidden(role=ContentRole.VIEWER) is True

    async def test_an_editor_sees_the_whole_meeting(self) -> None:
        assert await self._hidden(role=ContentRole.EDITOR) is False

    async def test_somebody_on_the_meeting_sees_it(self) -> None:
        viewer = User(id=VIEWER, email="grace@example.com", username="grace")
        attendee = EventAttendee(event_id=generate_id(), user_id=VIEWER)

        master = _series(visibility=EventVisibility.PRIVATE)
        attendee.event_id = master.id
        session = _session(attendees=[(attendee, viewer)])

        with self._resolver(ContentRole.VIEWER):
            exports = await build_exports(
                session,
                [master],
                viewer_id=VIEWER,
                organization_id=ORG,
            )

        assert exports[0].details_hidden is False

    async def test_an_ordinary_event_costs_no_authorization_round_trip(self) -> None:
        """Only a private event can be hidden, so nothing else pays for it."""
        master = _series()
        session = _session()

        with self._resolver(None) as resolver:
            exports = await build_exports(
                session,
                [master],
                viewer_id=VIEWER,
                organization_id=ORG,
            )

        assert exports[0].details_hidden is False
        resolver.assert_not_called()


class TestFilename:
    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("Standup", "Standup.ics"),
            ("Q3 Review / Planning", "Q3-Review-Planning.ics"),
            ("../../etc/passwd", "etc-passwd.ics"),
            ("   ", "calendar.ics"),
            ("", "calendar.ics"),
        ],
    )
    def test_titles_become_safe_filenames(self, title: str, expected: str) -> None:
        assert _filename(title) == expected

    def test_a_long_title_is_truncated(self) -> None:
        name = _filename("x" * 300)

        assert name.endswith(".ics")
        assert len(name) <= 64  # noqa: PLR2004
