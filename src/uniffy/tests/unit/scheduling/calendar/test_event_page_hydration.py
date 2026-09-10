"""Hydrating a page of events costs a fixed number of queries, whatever the page
holds."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import RoomType, generate_id
from uniffy.domains.scheduling.calendar.queries import get_attendees_for_events
from uniffy.domains.scheduling.rooms.projection import get_room_info_for_events

PAGE = [generate_id() for _ in range(50)]


class _Scalars(list):
    """Reads here either iterate the scalar result or call ``all()`` on it."""

    def all(self) -> list:
        return list(self)


def _rows(rows: list) -> MagicMock:
    return MagicMock(all=MagicMock(return_value=rows))


def _scalars(rows: list) -> MagicMock:
    return MagicMock(scalars=MagicMock(return_value=_Scalars(rows)))


def _booking(event_id, room_id) -> RoomBooking:
    return RoomBooking(
        room_id=room_id,
        organization_id=generate_id(),
        user_id=generate_id(),
        event_id=event_id,
        start_time=datetime(2026, 9, 7, 9, tzinfo=UTC),
        end_time=datetime(2026, 9, 7, 10, tzinfo=UTC),
    )


async def test_attendees_for_a_page_are_read_in_one_query() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=_rows([]))

    await get_attendees_for_events(session, PAGE)

    assert session.execute.await_count == 1


async def test_attendees_for_an_empty_page_read_nothing() -> None:
    session = MagicMock()
    session.execute = AsyncMock()

    assert await get_attendees_for_events(session, []) == {}
    session.execute.assert_not_awaited()


async def test_room_details_for_a_page_are_read_in_two_queries() -> None:
    room = Room(
        name="Aurora",
        organization_id=generate_id(),
        owner_id=generate_id(),
        room_type=RoomType.MEETING_ROOM,
        capacity=8,
    )
    bookings = [_booking(event_id, room.id) for event_id in PAGE]
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalars(bookings), _scalars([room])])

    details = await get_room_info_for_events(session, PAGE)

    assert session.execute.await_count == 2
    assert len(details) == len(PAGE)
    assert details[PAGE[0]]["room_name"] == "Aurora"


async def test_room_details_stop_after_finding_no_bookings() -> None:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_scalars([])])

    assert await get_room_info_for_events(session, PAGE) == {}
    assert session.execute.await_count == 1
