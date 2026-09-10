"""Read models exported to other domains."""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.domains.scheduling.rooms import queries
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations


def _room_details(booking: RoomBooking, room: Room | None) -> dict[str, object]:
    return {
        "room_id": str(booking.room_id),
        "room_name": room.name if room else "",
        "room_location": room.location if room else "",
        "room_capacity": room.capacity if room else 0,
        "room_amenities": list(room.amenities) if room and room.amenities else [],
    }


async def get_event_room_info(session: AsyncSession, event_id: UUID) -> dict[str, object]:
    booking = await queries.get_booking_for_event(session, event_id)
    if not booking:
        return {}

    room = (
        await session.execute(select(Room).where(Room.id == booking.room_id))
    ).scalar_one_or_none()
    return _room_details(booking, room)


async def get_room_info_for_events(
    session: AsyncSession,
    event_ids: Sequence[UUID],
) -> dict[UUID, dict[str, object]]:
    """Room details for many events in two queries, keyed by event. An event
    with no confirmed booking is absent rather than mapped to an empty payload.
    """
    bookings = await queries.get_bookings_for_events(session, event_ids)
    if not bookings:
        return {}

    room_ids = {booking.room_id for booking in bookings}
    rooms = {
        room.id: room
        for room in (await session.execute(select(Room).where(Room.id.in_(room_ids)))).scalars()
    }
    return {
        booking.event_id: _room_details(booking, rooms.get(booking.room_id)) for booking in bookings
    }


async def get_viewable_room_busy_intervals(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    room_id: UUID,
    range_start: datetime,
    range_end: datetime,
) -> list[tuple[datetime, datetime]]:
    await RoomOperations(session).get_by_id(user_id, organization_id, room_id)
    return await queries.get_room_busy_intervals(
        session,
        organization_id,
        room_id,
        range_start,
        range_end,
    )
