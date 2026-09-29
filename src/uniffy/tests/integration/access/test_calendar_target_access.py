"""An event lands only on a calendar its author may edit.

`calendar_id` arrives from the request on create, move and import, so each is
gated on the author's role on that calendar: an editor of a shared calendar may
file on it, a viewer may not, and a calendar the author cannot see - a
colleague's private one, another tenant's - answers as if it did not exist. The
gates are asserted against the rows that exist afterwards.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    RecurrencePattern,
    SubjectType,
    generate_id,
)
from uniffy.domains.scheduling.calendar.ical.ingest import preview_import
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

EMPTY_ICS = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n"


def _indexer() -> SearchIndexer:
    return MagicMock(spec=SearchIndexer)


async def _calendar(session, *, organization_id, owner_id, shared_with=None, role=None) -> Calendar:
    calendar = Calendar(
        organization_id=organization_id,
        owner_id=owner_id,
        name=f"cal-{generate_id().hex[:8]}",
        access_mode=AccessMode.EXPLICIT_MEMBERS if shared_with else AccessMode.OWNER_ONLY,
    )
    session.add(calendar)
    await session.flush()
    if shared_with:
        session.add(
            ContentMember(
                organization_id=organization_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar.id,
                subject_type=SubjectType.USER,
                subject_id=shared_with,
                role=role,
                added_by_user_id=owner_id,
            )
        )
    await session.commit()
    return calendar


async def _create(session, access, *, calendar_id, title, author=None) -> CalendarEvent:
    start = datetime.now(UTC) + timedelta(days=1)
    return await CalendarEventOperations(session, _indexer()).create(
        user_id=author or access.member_id,
        organization_id=access.org_id,
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        calendar_id=calendar_id,
    )


async def _events_titled(session, access, title) -> int:
    return await session.scalar(
        select(func.count())
        .select_from(CalendarEvent)
        .where(
            CalendarEvent.organization_id == access.org_id,
            CalendarEvent.title == title,
        )
    )


async def _move(session, access, event_id, calendar_id, *, author=None) -> CalendarEvent:
    return await CalendarEventOperations(session, _indexer()).update(
        user_id=author or access.member_id,
        organization_id=access.org_id,
        event_id=event_id,
        calendar_id=calendar_id,
        call_lifecycle=MagicMock(),
    )


class TestCreateTargetsAnEditableCalendar:
    async def test_the_author_files_on_their_own_calendar(self, session, access) -> None:
        calendar = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)

        event = await _create(session, access, calendar_id=calendar.id, title="own-calendar")

        assert event.calendar_id == calendar.id

    async def test_an_editor_files_on_a_shared_calendar(self, session, access) -> None:
        calendar = await _calendar(
            session,
            organization_id=access.org_id,
            owner_id=access.member_id,
            shared_with=access.peer_id,
            role=ContentRole.EDITOR,
        )

        event = await _create(
            session, access, calendar_id=calendar.id, title="team-entry", author=access.peer_id
        )

        assert (event.calendar_id, event.organizer_id) == (calendar.id, access.peer_id)

    async def test_a_viewer_is_refused(self, session, access) -> None:
        calendar = await _calendar(
            session,
            organization_id=access.org_id,
            owner_id=access.member_id,
            shared_with=access.peer_id,
            role=ContentRole.VIEWER,
        )
        title = f"viewer-{generate_id().hex[:8]}"

        with pytest.raises(PermissionDeniedError):
            await _create(
                session, access, calendar_id=calendar.id, title=title, author=access.peer_id
            )
        await session.rollback()

        assert await _events_titled(session, access, title) == 0

    async def test_a_colleagues_calendar_is_refused(self, session, access) -> None:
        calendar = await _calendar(session, organization_id=access.org_id, owner_id=access.peer_id)
        title = f"planted-{generate_id().hex[:8]}"

        with pytest.raises(NotFoundError):
            await _create(session, access, calendar_id=calendar.id, title=title)
        await session.rollback()

        assert await _events_titled(session, access, title) == 0

    async def test_another_tenants_calendar_is_refused(self, session, access) -> None:
        """The organization is compared too, so a leaked id from elsewhere is
        as useless as one that does not exist."""
        calendar = await _calendar(
            session, organization_id=access.other_org_id, owner_id=access.outsider_id
        )
        title = f"cross-tenant-{generate_id().hex[:8]}"

        with pytest.raises(NotFoundError):
            await _create(session, access, calendar_id=calendar.id, title=title)
        await session.rollback()

        assert await _events_titled(session, access, title) == 0

    async def test_an_unknown_calendar_is_refused(self, session, access) -> None:
        title = f"nowhere-{generate_id().hex[:8]}"

        with pytest.raises(NotFoundError):
            await _create(session, access, calendar_id=generate_id(), title=title)
        await session.rollback()

        assert await _events_titled(session, access, title) == 0


class TestMoveTargetsAnEditableCalendar:
    async def test_an_event_cannot_be_moved_onto_a_colleagues_calendar(
        self, session, access
    ) -> None:
        mine = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        theirs = await _calendar(session, organization_id=access.org_id, owner_id=access.peer_id)
        event = await _create(session, access, calendar_id=mine.id, title="stays-put")
        # Read through the ids before the rollback expires the instances.
        mine_id, theirs_id, event_id = mine.id, theirs.id, event.id

        with pytest.raises(NotFoundError):
            await _move(session, access, event_id, theirs_id)
        await session.rollback()

        assert (
            await session.scalar(
                select(CalendarEvent.calendar_id).where(CalendarEvent.id == event_id)
            )
            == mine_id
        )

    async def test_a_calendar_editor_cannot_move_someone_elses_event(
        self, session, access
    ) -> None:
        """Moving changes who can read the event, so editing it is not enough."""
        team = await _calendar(
            session,
            organization_id=access.org_id,
            owner_id=access.peer_id,
            shared_with=access.member_id,
            role=ContentRole.EDITOR,
        )
        mine = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        event = await _create(
            session, access, calendar_id=team.id, title="team-sync", author=access.peer_id
        )
        team_id, mine_id, event_id = team.id, mine.id, event.id

        with pytest.raises(PermissionDeniedError):
            await _move(session, access, event_id, mine_id)
        await session.rollback()

        assert (
            await session.scalar(
                select(CalendarEvent.calendar_id).where(CalendarEvent.id == event_id)
            )
            == team_id
        )

    async def test_a_series_moves_with_its_edited_occurrences(self, session, access) -> None:
        mine = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        team = await _calendar(
            session,
            organization_id=access.org_id,
            owner_id=access.peer_id,
            shared_with=access.member_id,
            role=ContentRole.EDITOR,
        )
        start = datetime.now(UTC) + timedelta(days=1)
        master = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=mine.id,
            title="standup",
            start_time=start,
            end_time=start + timedelta(minutes=15),
            access_mode=AccessMode.OWNER_ONLY,
            recurrence_pattern=RecurrencePattern.DAILY,
        )
        session.add(master)
        await session.flush()
        override = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=mine.id,
            recurrence_id=master.id,
            title="standup (late)",
            start_time=start + timedelta(days=1, hours=1),
            end_time=start + timedelta(days=1, hours=1, minutes=15),
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(override)
        await session.commit()
        master_id, override_id, team_id = master.id, override.id, team.id

        await _move(session, access, master_id, team_id)

        placed = set(
            (
                await session.execute(
                    select(CalendarEvent.calendar_id).where(
                        CalendarEvent.id.in_([master_id, override_id])
                    )
                )
            ).scalars()
        )
        assert placed == {team_id}

    async def test_one_edited_occurrence_cannot_leave_its_series(self, session, access) -> None:
        mine = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        other = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        start = datetime.now(UTC) + timedelta(days=1)
        master = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=mine.id,
            title="review",
            start_time=start,
            end_time=start + timedelta(hours=1),
            access_mode=AccessMode.OWNER_ONLY,
            recurrence_pattern=RecurrencePattern.WEEKLY,
        )
        session.add(master)
        await session.flush()
        override = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=mine.id,
            recurrence_id=master.id,
            title="review (moved)",
            start_time=start + timedelta(days=7, hours=2),
            end_time=start + timedelta(days=7, hours=3),
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(override)
        await session.commit()
        override_id, mine_id, other_id = override.id, mine.id, other.id

        with pytest.raises(ValidationError):
            await _move(session, access, override_id, other_id)
        await session.rollback()

        assert (
            await session.scalar(
                select(CalendarEvent.calendar_id).where(CalendarEvent.id == override_id)
            )
            == mine_id
        )


class TestImportFollowsTheCalendarRole:
    async def test_importing_takes_edit_on_the_calendar(self, session, access) -> None:
        calendar = await _calendar(
            session,
            organization_id=access.org_id,
            owner_id=access.member_id,
            shared_with=access.peer_id,
            role=ContentRole.VIEWER,
        )

        with pytest.raises(PermissionDeniedError):
            await preview_import(
                session,
                user_id=access.peer_id,
                organization_id=access.org_id,
                calendar_id=calendar.id,
                payload=EMPTY_ICS,
            )
