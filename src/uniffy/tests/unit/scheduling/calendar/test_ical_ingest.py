"""Importing a file: what gets created, what is refused, and what a second
import of the same file does."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import AccessMode, ContentRole, RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.ical import ingest as ingest_module
from uniffy.domains.scheduling.calendar.ical.ingest import apply_import, preview_import
from uniffy.domains.scheduling.calendar.search import CalendarEventProjection

OWNER = generate_id()
ORG = generate_id()
CALENDAR = generate_id()

HEADER = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
FOOTER = b"END:VCALENDAR\r\n"


def _vevent(uid: str, *, summary: str = "Meeting", extra: bytes = b"") -> bytes:
    return (
        b"BEGIN:VEVENT\r\nUID:" + uid.encode() + b"\r\n"
        b"SUMMARY:" + summary.encode() + b"\r\n"
        b"DTSTART:20260318T090000Z\r\nDTEND:20260318T093000Z\r\n" + extra + b"END:VEVENT\r\n"
    )


def _document(*bodies: bytes) -> bytes:
    return HEADER + b"".join(bodies) + FOOTER


async def _calendar_gate(session, user_id, organization_id, calendar_id):
    """Stands in for the role gate: the fake session's owner holds the calendar, nobody else."""
    if vars(session).get("_owner", user_id) != user_id:
        raise NotFoundError("Calendar", calendar_id)
    return ContentRole.OWNER


@pytest.fixture(autouse=True)
def _calendar_role_gate(monkeypatch):
    monkeypatch.setattr(ingest_module, "require_calendar_edit", _calendar_gate)


class _Session:
    """Records what a transaction would write, without a database."""

    def __init__(self, *, owner=OWNER, existing: list[str] | None = None) -> None:
        self.added: list = []
        self.committed = False
        self.rolled_back = False
        self._owner = owner
        self._existing = existing or []

    def add(self, row) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def scalar(self, _statement):
        return self._owner

    async def execute(self, _statement):
        scalars = MagicMock()
        scalars.all = MagicMock(return_value=list(self._existing))
        return MagicMock(scalars=MagicMock(return_value=scalars))

    def events(self) -> list[CalendarEvent]:
        return [row for row in self.added if isinstance(row, CalendarEvent)]

    def exceptions(self) -> list[RecurrenceException]:
        return [row for row in self.added if isinstance(row, RecurrenceException)]


async def _apply(session: _Session, payload: bytes):
    return await apply_import(
        session,
        user_id=OWNER,
        organization_id=ORG,
        calendar_id=CALENDAR,
        payload=payload,
    )


class TestOwnership:
    async def test_importing_into_another_members_calendar_is_refused(self) -> None:
        """Calendars carry no content role yet, so the gate is ownership."""
        session = _Session(owner=generate_id())

        with pytest.raises(NotFoundError):
            await preview_import(
                session,
                user_id=OWNER,
                organization_id=ORG,
                calendar_id=CALENDAR,
                payload=_document(_vevent("a@example.com")),
            )

    async def test_a_calendar_that_does_not_exist_is_refused(self) -> None:
        session = _Session(owner=None)

        with pytest.raises(NotFoundError):
            await preview_import(
                session,
                user_id=OWNER,
                organization_id=ORG,
                calendar_id=CALENDAR,
                payload=_document(_vevent("a@example.com")),
            )


class TestPreview:
    async def test_preview_writes_nothing(self) -> None:
        session = _Session()

        preview = await preview_import(
            session,
            user_id=OWNER,
            organization_id=ORG,
            calendar_id=CALENDAR,
            payload=_document(_vevent("a@example.com")),
        )

        assert len(preview.creatable) == 1
        assert session.added == []
        assert not session.committed

    async def test_entries_already_present_are_reported_as_duplicates(self) -> None:
        session = _Session(existing=["a@example.com"])

        preview = await preview_import(
            session,
            user_id=OWNER,
            organization_id=ORG,
            calendar_id=CALENDAR,
            payload=_document(_vevent("a@example.com"), _vevent("b@example.com")),
        )

        assert [event.ical_uid for event in preview.creatable] == ["b@example.com"]
        assert [event.ical_uid for event in preview.duplicates] == ["a@example.com"]

    async def test_unusable_entries_are_reported_with_reasons(self) -> None:
        session = _Session()

        preview = await preview_import(
            session,
            user_id=OWNER,
            organization_id=ORG,
            calendar_id=CALENDAR,
            payload=_document(
                _vevent("a@example.com"),
                _vevent("b@example.com", extra=b"RRULE:FREQ=MONTHLY;BYDAY=3TU\r\n"),
            ),
        )

        assert len(preview.creatable) == 1
        assert len(preview.skipped) == 1
        assert preview.skipped[0].message


class TestApply:
    async def test_events_are_created_owned_by_the_importer(self) -> None:
        session = _Session()

        outcome = await _apply(session, _document(_vevent("a@example.com")))

        assert len(outcome.created_ids) == 1
        created = session.events()[0]
        assert created.organizer_id == OWNER
        assert created.calendar_id == CALENDAR
        assert created.ical_uid == "a@example.com"
        # Imported events are private to the importer, like every created event.
        assert created.access_mode is AccessMode.OWNER_ONLY
        assert session.committed

    async def test_cancelled_occurrences_become_exception_rows(self) -> None:
        session = _Session()
        payload = _document(
            _vevent(
                "series@example.com",
                extra=b"RRULE:FREQ=WEEKLY;BYDAY=WE\r\nEXDATE:20260325T090000Z\r\n",
            )
        )

        await _apply(session, payload)

        created = session.events()[0]
        assert created.recurrence_pattern is RecurrencePattern.WEEKLY
        exceptions = session.exceptions()
        assert len(exceptions) == 1
        assert exceptions[0].is_cancelled
        assert exceptions[0].event_id == created.id

    async def test_a_moved_occurrence_becomes_an_override_pointing_at_its_series(self) -> None:
        session = _Session()
        moved = (
            b"BEGIN:VEVENT\r\nUID:series@example.com\r\n"
            b"RECURRENCE-ID:20260325T090000Z\r\n"
            b"SUMMARY:Moved\r\n"
            b"DTSTART:20260325T140000Z\r\nDTEND:20260325T143000Z\r\nEND:VEVENT\r\n"
        )
        payload = _document(
            _vevent("series@example.com", extra=b"RRULE:FREQ=WEEKLY;BYDAY=WE\r\n"),
            moved,
        )

        await _apply(session, payload)

        events = session.events()
        assert len(events) == 2
        master, override = events
        assert override.recurrence_id == master.id
        assert override.title == "Moved"
        # The series already holds the file's UID, and the partial unique index
        # would refuse a second row carrying it.
        assert override.ical_uid is None
        assert session.exceptions()[0].override_event_id == override.id

    async def test_re_importing_the_same_file_creates_nothing(self) -> None:
        """The acceptance criterion: never duplicates on a second import."""
        first = _Session()
        await _apply(first, _document(_vevent("a@example.com")))

        second = _Session(existing=["a@example.com"])
        outcome = await _apply(second, _document(_vevent("a@example.com")))

        assert outcome.created_ids == ()
        assert outcome.duplicate_count == 1
        assert second.events() == []

    async def test_a_failure_rolls_the_whole_file_back(self) -> None:
        """A partial import leaves a series without its exclusions, which reads
        as a different meeting."""
        session = _Session()
        session.commit = AsyncMock(side_effect=RuntimeError("database is gone"))
        session.rollback = AsyncMock()

        with pytest.raises(RuntimeError):
            await _apply(session, _document(_vevent("a@example.com")))

        session.rollback.assert_awaited_once()

    async def test_an_empty_file_is_accepted_and_does_nothing(self) -> None:
        session = _Session()

        outcome = await _apply(session, _document())

        assert outcome.created_ids == ()
        assert outcome.skipped == ()


class TestProjection:
    @staticmethod
    def _projection(**kwargs) -> MagicMock:
        projection = MagicMock(spec=CalendarEventProjection)
        projection.index = AsyncMock(**kwargs)
        return projection

    async def test_a_stale_search_projection_does_not_fail_the_import(self) -> None:
        session = _Session()
        projection = self._projection(side_effect=RuntimeError("search is down"))

        outcome = await apply_import(
            session,
            user_id=OWNER,
            organization_id=ORG,
            calendar_id=CALENDAR,
            payload=_document(_vevent("a@example.com")),
            projection=projection,
        )

        assert len(outcome.created_ids) == 1
        assert session.committed

    async def test_created_events_are_indexed(self) -> None:
        session = _Session()
        projection = self._projection()

        await apply_import(
            session,
            user_id=OWNER,
            organization_id=ORG,
            calendar_id=CALENDAR,
            payload=_document(_vevent("a@example.com"), _vevent("b@example.com")),
            projection=projection,
        )

        assert projection.index.await_count == 2  # noqa: PLR2004
