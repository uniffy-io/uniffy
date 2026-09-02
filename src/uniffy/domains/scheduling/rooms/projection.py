"""Read models exported to other domains."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.rooms.room import Room
from uniffy.domains.scheduling.rooms import queries
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations


async def get_event_room_info(session: AsyncSession, event_id: UUID) -> dict[str, object]:
    booking = await queries.get_booking_for_event(session, event_id)
    if not booking:
        return {}

    room = (
        await session.execute(select(Room).where(Room.id == booking.room_id))
    ).scalar_one_or_none()
    return {
        "room_id": str(booking.room_id),
        "room_name": room.name if room else "",
        "room_location": room.location if room else "",
        "room_capacity": room.capacity if room else 0,
        "room_amenities": list(room.amenities) if room and room.amenities else [],
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
