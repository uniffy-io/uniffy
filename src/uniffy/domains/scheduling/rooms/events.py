"""Room-owned booking boundary for calendar events."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.types import BookingStatus, RoomStatus
from uniffy.domains.scheduling.rooms import queries
from uniffy.domains.scheduling.rooms.bookings import BookingOperations
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations


class EventBookingOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.bookings = BookingOperations(session)

    async def validate_room(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> None:
        room = await RoomOperations(self.session).get_by_id(user_id, organization_id, room_id)
        if room.status != RoomStatus.ACTIVE:
            raise ValidationError(
                "room",
                f"Room '{room.name}' is not available for booking (status: {room.status.value}).",
            )
        if await queries.check_booking_conflict(self.session, room_id, start_time, end_time):
            raise ValidationError("room", "Room is already booked for this time slot.")

    async def stage(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        start_time: datetime,
        end_time: datetime,
        title: str,
        event_id: UUID,
    ) -> RoomBooking:
        return await self.bookings.stage_booking(
            user_id=user_id,
            organization_id=organization_id,
            room_id=room_id,
            start_time=start_time,
            end_time=end_time,
            title=title,
            event_id=event_id,
        )

    async def cancel(self, event_id: UUID) -> None:
        await self.bookings.cancel_booking_for_event(event_id)

    async def stage_cancel(self, organization_id: UUID, event_ids: Sequence[UUID]) -> None:
        await self.session.execute(
            update(RoomBooking)
            .where(
                RoomBooking.organization_id == organization_id,
                RoomBooking.event_id.in_(event_ids),
            )
            .values(status=BookingStatus.CANCELLED, updated_at=datetime.now(UTC))
        )

    async def replace(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        room_id: UUID | None,
        start_time: datetime,
        end_time: datetime,
        title: str,
    ) -> RoomBooking | None:
        await self.cancel(event_id)
        if room_id is None:
            return None
        return await self.bookings.create_booking(
            user_id=user_id,
            organization_id=organization_id,
            room_id=room_id,
            start_time=start_time,
            end_time=end_time,
            title=title,
            event_id=event_id,
        )
