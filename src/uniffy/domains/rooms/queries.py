from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, exists, not_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.models.shared import BookingStatus, RoomStatus, RoomType


async def check_booking_conflict(
    session: AsyncSession,
    room_id: UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_booking_id: UUID | None = None,
) -> bool:
    query = select(
        exists().where(
            and_(
                RoomBooking.room_id == room_id,
                RoomBooking.status == BookingStatus.CONFIRMED,
                RoomBooking.start_time < end_time,
                RoomBooking.end_time > start_time,
            )
        )
    )

    if exclude_booking_id is not None:
        query = select(
            exists().where(
                and_(
                    RoomBooking.room_id == room_id,
                    RoomBooking.status == BookingStatus.CONFIRMED,
                    RoomBooking.start_time < end_time,
                    RoomBooking.end_time > start_time,
                    RoomBooking.id != exclude_booking_id,
                )
            )
        )

    result = await session.execute(query)
    return bool(result.scalar())


async def get_room_bookings_in_range(
    session: AsyncSession,
    room_id: UUID,
    start_date: datetime,
    end_date: datetime,
) -> list[tuple[RoomBooking, str]]:
    booker = aliased(User)

    query = (
        select(RoomBooking, booker)
        .join(booker, RoomBooking.user_id == booker.id)
        .where(
            and_(
                RoomBooking.room_id == room_id,
                RoomBooking.status == BookingStatus.CONFIRMED,
                RoomBooking.start_time < end_date,
                RoomBooking.end_time > start_date,
            )
        )
        .order_by(RoomBooking.start_time.asc())
    )

    result = await session.execute(query)
    rows = result.all()

    bookings: list[tuple[RoomBooking, str]] = []
    for booking, user in rows:
        display_name = user.full_name or user.username or user.email
        bookings.append((booking, display_name))

    return bookings


async def find_available_rooms(
    session: AsyncSession,
    organization_id: UUID,
    start_time: datetime,
    end_time: datetime,
    min_capacity: int | None = None,
    amenities: list[str] | None = None,
    room_type: RoomType | None = None,
) -> list[Room]:
    conflict_subquery = select(RoomBooking.id).where(
        and_(
            RoomBooking.room_id == Room.id,
            RoomBooking.status == BookingStatus.CONFIRMED,
            RoomBooking.start_time < end_time,
            RoomBooking.end_time > start_time,
        )
    )

    query = select(Room).where(
        and_(
            Room.organization_id == organization_id,
            Room.status == RoomStatus.ACTIVE,
            Room.is_deleted == False,  # noqa: E712
            not_(exists(conflict_subquery)),
        )
    )

    if min_capacity is not None:
        query = query.where(Room.capacity >= min_capacity)

    if room_type is not None:
        query = query.where(Room.room_type == room_type)

    if amenities:
        query = query.where(Room.amenities.contains(amenities))

    query = query.order_by(Room.name.asc())

    result = await session.execute(query)
    return list(result.scalars().all())


async def get_booking_for_event(
    session: AsyncSession,
    event_id: UUID,
) -> RoomBooking | None:
    result = await session.execute(
        select(RoomBooking).where(
            and_(
                RoomBooking.event_id == event_id,
                RoomBooking.status == BookingStatus.CONFIRMED,
            )
        )
    )
    return result.scalar_one_or_none()
