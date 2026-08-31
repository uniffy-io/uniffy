"""Tests for the agents rooms tools and the calendar room atomicity precheck."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.errors import ValidationError
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import BookingStatus, RoomStatus, RoomType, generate_id
from uniffy.domains.agents.tools.builtin.rooms import (
    ROOMS_TOOLS,
    _execute_book_room,
    _execute_cancel_booking,
    _execute_find_available,
    _execute_get_room,
    _execute_list_bookings,
    _execute_list_rooms,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _ctx() -> ToolContext:
    session = MagicMock()
    session.commit = AsyncMock()
    return ToolContext(
        session=session,
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        session_id=generate_id(),
        user_timezone="UTC",
    )


def _make_room(**overrides) -> Room:
    defaults = dict(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Boardroom",
        description="",
        room_type=RoomType.CONFERENCE_ROOM,
        capacity=8,
        floor="2",
        building="HQ",
        location="HQ, Floor 2",
        amenities=["whiteboard"],
        status=RoomStatus.ACTIVE,
        is_deleted=False,
    )
    defaults.update(overrides)
    return Room(**defaults)


def _make_booking(**overrides) -> RoomBooking:
    now = datetime.now(UTC)
    defaults = dict(
        id=generate_id(),
        room_id=generate_id(),
        organization_id=generate_id(),
        user_id=generate_id(),
        event_id=None,
        title="Standup",
        start_time=now,
        end_time=now + timedelta(hours=1),
        status=BookingStatus.CONFIRMED,
        notes="",
    )
    defaults.update(overrides)
    return RoomBooking(**defaults)


class TestToolDefinitions:
    def test_six_tools_exported_with_expected_flags(self) -> None:
        by_name = {t.name: t for t in ROOMS_TOOLS}
        assert set(by_name) == {
            "rooms.list_rooms",
            "rooms.get_room",
            "rooms.list_bookings",
            "rooms.find_available",
            "rooms.book_room",
            "rooms.cancel_booking",
        }
        # Read-only flags
        read_tools = (
            "rooms.list_rooms",
            "rooms.get_room",
            "rooms.list_bookings",
            "rooms.find_available",
        )
        for read in read_tools:
            assert by_name[read].read_only is True, read
            assert by_name[read].destructive is False, read
        # find_available gets a longer timeout
        assert by_name["rooms.find_available"].timeout_seconds == 30
        # Write tools
        assert by_name["rooms.book_room"].read_only is False
        assert by_name["rooms.book_room"].destructive is False
        # cancel_booking is destructive (gated through approval flow)
        assert by_name["rooms.cancel_booking"].destructive is True


class TestListRoomsExecutor:
    async def test_filters_passed_through_and_results_rendered(self) -> None:
        ctx = _ctx()
        rooms = [
            _make_room(name="Alpha", capacity=4),
            _make_room(name="Beta", capacity=10, amenities=["whiteboard", "video"]),
        ]

        with patch(
            "uniffy.domains.scheduling.rooms.lifecycle.RoomOperations.list_rooms",
            new=AsyncMock(return_value=(rooms, 2)),
        ) as mock_list:
            result = await _execute_list_rooms(
                ctx,
                {
                    "min_capacity": 4,
                    "amenities": ["whiteboard"],
                    "building": "HQ",
                    "search_query": "alpha",
                    "page": 1,
                    "page_size": 50,
                },
            )

        assert result.success
        assert "Found 2 rooms" in result.data
        assert "Alpha" in result.data
        assert "Beta" in result.data
        assert "urn:uniffy:content:ROOM:" in result.data

        call_kwargs = mock_list.await_args.kwargs
        assert call_kwargs["user_id"] == ctx.user_id
        assert call_kwargs["organization_id"] == ctx.organization_id
        assert call_kwargs["min_capacity"] == 4
        assert call_kwargs["amenities"] == ["whiteboard"]
        assert call_kwargs["building"] == "HQ"
        assert call_kwargs["search_query"] == "alpha"
        assert call_kwargs["page"] == 1
        assert call_kwargs["page_size"] == 50

    async def test_empty_result_returns_friendly_message(self) -> None:
        ctx = _ctx()
        with patch(
            "uniffy.domains.scheduling.rooms.lifecycle.RoomOperations.list_rooms",
            new=AsyncMock(return_value=([], 0)),
        ):
            result = await _execute_list_rooms(ctx, {})
        assert result.success
        assert result.data == "No rooms found."


class TestGetRoomExecutor:
    async def test_returns_detail_plus_upcoming_bookings(self) -> None:
        ctx = _ctx()
        room = _make_room(name="Phone Booth")
        slot = {
            "start_time": "2026-06-01T10:00:00+00:00",
            "end_time": "2026-06-01T10:30:00+00:00",
            "is_available": False,
            "booking_id": str(generate_id()),
            "event_title": "Quick Sync",
            "booker_name": "Alice",
        }
        with (
            patch(
                "uniffy.domains.scheduling.rooms.lifecycle.RoomOperations.get_by_id",
                new=AsyncMock(return_value=room),
            ),
            patch(
                "uniffy.domains.scheduling.rooms.bookings.BookingOperations.check_availability",
                new=AsyncMock(return_value=[slot]),
            ),
        ):
            result = await _execute_get_room(ctx, {"room_id": str(room.id)})

        assert result.success
        assert "Phone Booth" in result.data
        assert f"urn:uniffy:content:ROOM:{room.id}" in result.data
        assert "Capacity: 8" in result.data
        assert "Upcoming bookings (next 7 days)" in result.data
        assert "Quick Sync" in result.data
        assert "by Alice" in result.data

    async def test_missing_room_id_is_a_validation_error(self) -> None:
        ctx = _ctx()
        result = await _execute_get_room(ctx, {})
        assert result.success is False
        assert "room_id is required" in result.error

    async def test_invalid_uuid_is_a_validation_error(self) -> None:
        ctx = _ctx()
        result = await _execute_get_room(ctx, {"room_id": "not-a-uuid"})
        assert result.success is False
        assert "Invalid room_id" in result.error


class TestListBookingsExecutor:
    async def test_paginated_output_with_room_and_booker_names(self) -> None:
        ctx = _ctx()
        booking = _make_booking(title="Planning")
        with patch(
            "uniffy.domains.scheduling.rooms.bookings.BookingOperations.list_bookings",
            new=AsyncMock(return_value=([(booking, "Boardroom", "Bob")], 1)),
        ) as mock_list:
            result = await _execute_list_bookings(
                ctx,
                {
                    "room_id": str(booking.room_id),
                    "status": "CONFIRMED",
                },
            )
        assert result.success
        assert "Found 1 bookings" in result.data
        assert "Planning" in result.data
        assert "room=Boardroom" in result.data
        assert "by=Bob" in result.data

        call_kwargs = mock_list.await_args.kwargs
        assert call_kwargs["status"] == BookingStatus.CONFIRMED
        assert call_kwargs["room_id"] == booking.room_id


class TestFindAvailableExecutor:
    async def test_returns_unbooked_rooms_in_window(self) -> None:
        ctx = _ctx()
        rooms = [_make_room(name="Free Room", capacity=6)]
        with patch(
            "uniffy.domains.scheduling.rooms.bookings.BookingOperations.find_available_rooms",
            new=AsyncMock(return_value=rooms),
        ) as mock_find:
            result = await _execute_find_available(
                ctx,
                {
                    "start_time": "2026-06-01T10:00:00",
                    "end_time": "2026-06-01T11:00:00",
                    "min_capacity": 4,
                    "amenities": ["whiteboard"],
                    "room_type": "CONFERENCE_ROOM",
                },
            )

        assert result.success
        assert "Free Room" in result.data
        assert "available for" in result.data
        kwargs = mock_find.await_args.kwargs
        assert kwargs["min_capacity"] == 4
        assert kwargs["amenities"] == ["whiteboard"]
        assert kwargs["room_type"] == RoomType.CONFERENCE_ROOM
        assert kwargs["start_time"].tzinfo is not None
        assert kwargs["end_time"] > kwargs["start_time"]

    async def test_end_before_start_is_a_validation_error(self) -> None:
        ctx = _ctx()
        result = await _execute_find_available(
            ctx,
            {
                "start_time": "2026-06-01T11:00:00",
                "end_time": "2026-06-01T10:00:00",
            },
        )
        assert result.success is False
        assert "end_time must be after start_time" in result.error


class TestBookRoomExecutor:
    async def test_successful_booking_is_returned_with_detail(self) -> None:
        ctx = _ctx()
        booking = _make_booking(title="Pairing")
        with patch(
            "uniffy.domains.scheduling.rooms.bookings.BookingOperations.create_booking",
            new=AsyncMock(return_value=booking),
        ) as mock_create:
            result = await _execute_book_room(
                ctx,
                {
                    "room_id": str(booking.room_id),
                    "start_time": "2026-06-01T10:00:00",
                    "end_time": "2026-06-01T11:00:00",
                    "title": "Pairing",
                    "notes": "Discuss the migration",
                },
            )
        assert result.success
        assert "Booking created" in result.data
        assert "Pairing" in result.data
        kwargs = mock_create.await_args.kwargs
        assert kwargs["title"] == "Pairing"
        assert kwargs["notes"] == "Discuss the migration"

    async def test_conflict_returns_structured_failure(self) -> None:
        ctx = _ctx()
        with patch(
            "uniffy.domains.scheduling.rooms.bookings.BookingOperations.create_booking",
            new=AsyncMock(
                side_effect=ValidationError("room", "Room is already booked for this time slot.")
            ),
        ):
            result = await _execute_book_room(
                ctx,
                {
                    "room_id": str(generate_id()),
                    "start_time": "2026-06-01T10:00:00",
                    "end_time": "2026-06-01T11:00:00",
                },
            )
        assert result.success is False
        assert "already booked" in result.error


class TestCancelBookingExecutor:
    async def test_cancel_returns_detail(self) -> None:
        ctx = _ctx()
        booking = _make_booking(status=BookingStatus.CANCELLED)
        with patch(
            "uniffy.domains.scheduling.rooms.bookings.BookingOperations.cancel_booking",
            new=AsyncMock(return_value=booking),
        ) as mock_cancel:
            result = await _execute_cancel_booking(ctx, {"booking_id": str(booking.id)})
        assert result.success
        assert "Booking cancelled" in result.data
        assert "status=CANCELLED" in result.data
        kwargs = mock_cancel.await_args.kwargs
        assert kwargs["booking_id"] == booking.id


class TestCalendarRoomAtomicityPrecheck:
    """When room_id is provided to create_event, a booking conflict
    must be detected before the event is added to the session - no
    orphan event behind a 'already booked' error.
    """

    async def test_conflict_aborts_before_event_is_added(self) -> None:
        from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

        session = MagicMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.flush = AsyncMock()
        session.refresh = AsyncMock()

        ops = CalendarEventOperations(session)
        ops._resolve_access_policy = AsyncMock(return_value=(None, None))
        ops._expand_group_attendees = AsyncMock(side_effect=lambda ids: ids)

        room = _make_room()
        org_id = generate_id()
        user_id = generate_id()
        start = datetime.now(UTC)
        end = start + timedelta(hours=1)

        with (
            patch(
                "uniffy.domains.scheduling.rooms.lifecycle.RoomOperations.get_by_id",
                new=AsyncMock(return_value=room),
            ),
            patch(
                "uniffy.domains.scheduling.rooms.queries.check_booking_conflict",
                new=AsyncMock(return_value=True),
            ),
        ):
            raised = None
            try:
                await ops.create(
                    user_id=user_id,
                    organization_id=org_id,
                    title="Sync",
                    start_time=start,
                    end_time=end,
                    calendar_id=generate_id(),
                    room_id=room.id,
                )
            except ValidationError as e:
                raised = e

        assert raised is not None
        assert "already booked" in str(raised)
        # No CalendarEvent was added to the session.
        added_types = [
            call.args[0].__class__.__name__ for call in session.add.call_args_list if call.args
        ]
        assert "CalendarEvent" not in added_types

    async def test_inactive_room_aborts_before_event_is_added(self) -> None:
        from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

        session = MagicMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.flush = AsyncMock()

        ops = CalendarEventOperations(session)
        ops._resolve_access_policy = AsyncMock(return_value=(None, None))
        ops._expand_group_attendees = AsyncMock(side_effect=lambda ids: ids)

        room = _make_room(status=RoomStatus.MAINTENANCE)

        with patch(
            "uniffy.domains.scheduling.rooms.lifecycle.RoomOperations.get_by_id",
            new=AsyncMock(return_value=room),
        ):
            raised = None
            try:
                await ops.create(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    title="Sync",
                    start_time=datetime.now(UTC),
                    end_time=datetime.now(UTC) + timedelta(hours=1),
                    calendar_id=generate_id(),
                    room_id=room.id,
                )
            except ValidationError as e:
                raised = e

        assert raised is not None
        assert "MAINTENANCE" in str(raised)
        added_types = [
            call.args[0].__class__.__name__ for call in session.add.call_args_list if call.args
        ]
        assert "CalendarEvent" not in added_types
