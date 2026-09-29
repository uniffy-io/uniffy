"""An event lands only on a calendar its author holds.

`calendar_id` arrives from the request and was previously stored verbatim, so
a member could file an event on a colleague's calendar - or, since the
organization was never compared either, on another tenant's. The gate is
asserted here against real rows, because the question is which rows exist
afterwards, not which SQL was built.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from uniffy.core.errors import NotFoundError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search import SearchIndexer
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _indexer() -> SearchIndexer:
    return MagicMock(spec=SearchIndexer)


async def _calendar(session, *, organization_id, owner_id) -> Calendar:
    calendar = Calendar(
        organization_id=organization_id,
        owner_id=owner_id,
        name=f"cal-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.commit()
    return calendar


async def _create(session, access, *, calendar_id, title) -> CalendarEvent:
    start = datetime.now(UTC) + timedelta(days=1)
    return await CalendarEventOperations(session, _indexer()).create(
        user_id=access.member_id,
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


class TestCreateTargetsOwnCalendar:
    async def test_the_author_files_on_their_own_calendar(self, session, access) -> None:
        calendar = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)

        event = await _create(session, access, calendar_id=calendar.id, title="own-calendar")

        assert event.calendar_id == calendar.id

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


class TestMoveTargetsOwnCalendar:
    async def test_an_event_cannot_be_moved_onto_a_colleagues_calendar(
        self, session, access
    ) -> None:
        mine = await _calendar(session, organization_id=access.org_id, owner_id=access.member_id)
        theirs = await _calendar(session, organization_id=access.org_id, owner_id=access.peer_id)
        event = await _create(session, access, calendar_id=mine.id, title="stays-put")
        # Read through the ids before the rollback expires the instances.
        mine_id, theirs_id, event_id = mine.id, theirs.id, event.id

        with pytest.raises(NotFoundError):
            await CalendarEventOperations(session, _indexer()).update(
                user_id=access.member_id,
                organization_id=access.org_id,
                event_id=event_id,
                calendar_id=theirs_id,
                call_lifecycle=MagicMock(),
            )
        await session.rollback()

        assert (
            await session.scalar(
                select(CalendarEvent.calendar_id).where(CalendarEvent.id == event_id)
            )
            == mine_id
        )
