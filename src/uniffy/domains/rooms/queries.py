"""Room-specific database queries for booking availability and conflict detection."""

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
    """
    Check whether a proposed time range conflicts with existing bookings.

    A conflict exists when any CONFIRMED booking on the same room overlaps
    the given range (existing.start_time < end_time AND existing.end_time > start_time).

    Parameters
    ----------
    session : AsyncSession
        Database session.
    room_id : UUID
        Room to check.
    start_time : datetime
        Proposed booking start time.
    end_time : datetime
        Proposed booking end time.
    exclude_booking_id : UUID | None
        Booking ID to exclude from the check (used during updates).

    Returns
    -------
    bool
        True if a conflict exists, False otherwise.

    """
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
    """
    Get CONFIRMED bookings for a room within a date range, with booker names.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    room_id : UUID
        Room to query bookings for.
    start_date : datetime
        Start of the range.
    end_date : datetime
        End of the range.

    Returns
    -------
    list[tuple[RoomBooking, str]]
        List of (booking, booker_display_name) tuples ordered by start_time.

    """
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
    """
    Find rooms with no conflicting CONFIRMED bookings in the time range.

    Uses a NOT EXISTS subquery to exclude rooms that have any overlapping
    confirmed booking. Additional filters narrow down by capacity, amenities,
    and room type.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization scope.
    start_time : datetime
        Desired booking start time.
    end_time : datetime
        Desired booking end time.
    min_capacity : int | None
        Minimum room capacity (None = no filter).
    amenities : list[str] | None
        Required amenities; room must contain all listed (None = no filter).
    room_type : RoomType | None
        Required room type (None = no filter).

    Returns
    -------
    list[Room]
        Available rooms ordered by name.

    """
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
        # JSONB @> operator: room amenities must contain all requested amenities
        query = query.where(Room.amenities.contains(amenities))

    query = query.order_by(Room.name.asc())

    result = await session.execute(query)
    return list(result.scalars().all())


async def get_booking_for_event(
    session: AsyncSession,
    event_id: UUID,
) -> RoomBooking | None:
    """
    Find the CONFIRMED booking linked to a calendar event.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    event_id : UUID
        Calendar event ID.

    Returns
    -------
    RoomBooking | None
        The booking linked to the event, or None if not found.

    """
    result = await session.execute(
        select(RoomBooking).where(
            and_(
                RoomBooking.event_id == event_id,
                RoomBooking.status == BookingStatus.CONFIRMED,
            )
        )
    )
    return result.scalar_one_or_none()


