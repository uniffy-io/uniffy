"""Room booking lifecycle."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.models.shared import EventVisibility
from uniffy.core.types import BookingStatus, ContentType, RoomStatus, RoomType
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.scheduling.rooms import queries
from uniffy.domains.scheduling.rooms.lifecycle import RoomOperations


class BookingOperations:
    """Room bookings, which are not independently indexed content."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_booking(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        start_time: datetime,
        end_time: datetime,
        title: str = "",
        notes: str = "",
        event_id: UUID | None = None,
    ) -> RoomBooking:
        booking = await self.stage_booking(
            user_id=user_id,
            organization_id=organization_id,
            room_id=room_id,
            start_time=start_time,
            end_time=end_time,
            title=title,
            notes=notes,
            event_id=event_id,
        )
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(booking)
        return booking

    async def stage_booking(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        start_time: datetime,
        end_time: datetime,
        title: str = "",
        notes: str = "",
        event_id: UUID | None = None,
    ) -> RoomBooking:
        """Validate and stage a booking while serializing writers for its room."""
        room_ops = RoomOperations(self.session)
        room = (
            await self.session.execute(
                select(Room)
                .where(
                    Room.id == room_id,
                    Room.organization_id == organization_id,
                    Room.is_deleted.is_(False),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if room is None:
            raise NotFoundError("Room", room_id)
        await room_ops._require_view(user_id, organization_id, room)
        if room.status != RoomStatus.ACTIVE:
            raise ValidationError(
                "room",
                f"Room '{room.name}' is not available for booking (status: {room.status.value}).",
            )

        has_conflict = await queries.check_booking_conflict(
            self.session,
            room_id,
            start_time,
            end_time,
        )
        if has_conflict:
            raise ValidationError("room", "Room is already booked for this time slot.")

        booking = RoomBooking(
            room_id=room_id,
            organization_id=organization_id,
            user_id=user_id,
            event_id=event_id,
            title=title,
            start_time=start_time,
            end_time=end_time,
            notes=notes,
            status=BookingStatus.CONFIRMED,
        )
        self.session.add(booking)
        await self.session.flush()
        return booking

    async def cancel_booking(
        self,
        user_id: UUID,
        organization_id: UUID,
        booking_id: UUID,
    ) -> RoomBooking:
        result = await self.session.execute(
            select(RoomBooking).where(
                and_(
                    RoomBooking.id == booking_id,
                    RoomBooking.organization_id == organization_id,
                )
            )
        )
        booking = result.scalar_one_or_none()
        if not booking:
            raise NotFoundError("RoomBooking", booking_id)

        if booking.user_id != user_id:
            membership = await OrganizationOperations(self.session).require_org_member(
                user_id, organization_id
            )
            if membership.role not in (OrganizationRole.ADMIN, OrganizationRole.OWNER):
                raise PermissionDeniedError("cancel", "room booking")

        booking.status = BookingStatus.CANCELLED
        booking.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(booking)
        return booking

    async def get_booking(
        self,
        user_id: UUID,
        organization_id: UUID,
        booking_id: UUID,
    ) -> RoomBooking:
        result = await self.session.execute(
            select(RoomBooking).where(
                and_(
                    RoomBooking.id == booking_id,
                    RoomBooking.organization_id == organization_id,
                )
            )
        )
        booking = result.scalar_one_or_none()
        if not booking:
            raise NotFoundError("RoomBooking", booking_id)

        await RoomOperations(self.session).get_by_id(user_id, organization_id, booking.room_id)
        return booking

    async def list_bookings(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        status: BookingStatus | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[tuple[RoomBooking, str, str]], int]:
        booker = aliased(User)
        room_ops = RoomOperations(self.session)
        access_filter = await room_ops.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.ROOM,
            content_id_column=Room.id,
            owner_id_column=Room.owner_id,
            access_mode_column=Room.access_mode,
            baseline_role_column=Room.baseline_role,
        )

        query = (
            select(RoomBooking, Room.name, booker.full_name)
            .join(Room, RoomBooking.room_id == Room.id)
            .join(booker, RoomBooking.user_id == booker.id)
            .where(RoomBooking.organization_id == organization_id)
            .where(access_filter)
        )
        if room_id is not None:
            query = query.where(RoomBooking.room_id == room_id)
        if start_date is not None:
            query = query.where(RoomBooking.end_time > start_date)
        if end_date is not None:
            query = query.where(RoomBooking.start_time < end_date)
        if status is not None:
            query = query.where(RoomBooking.status == status)

        total = (
            await self.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar()
        query = query.order_by(RoomBooking.start_time.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)
        rows = (await self.session.execute(query)).all()
        return [
            (booking, room_name or "", booker_name or "") for booking, room_name, booker_name in rows
        ], total or 0

    async def check_availability(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        start_date: datetime,
        end_date: datetime,
    ) -> list[dict[str, object]]:
        await RoomOperations(self.session).get_by_id(user_id, organization_id, room_id)
        booking_rows = await queries.get_room_bookings_in_range(
            self.session,
            room_id,
            start_date,
            end_date,
        )
        hidden_event_ids = await self._private_event_ids_hidden_from(
            user_id, [booking.event_id for booking, _ in booking_rows if booking.event_id]
        )
        return [
            {
                "start_time": booking.start_time.isoformat(),
                "end_time": booking.end_time.isoformat(),
                "is_available": False,
                "booking_id": str(booking.id),
                "event_title": "" if booking.event_id in hidden_event_ids else booking.title,
                "booker_name": booker_name,
            }
            for booking, booker_name in booking_rows
        ]

    async def _private_event_ids_hidden_from(
        self, user_id: UUID, event_ids: list[UUID]
    ) -> set[UUID]:
        if not event_ids:
            return set()
        result = await self.session.execute(
            select(CalendarEvent.id).where(
                and_(
                    CalendarEvent.id.in_(event_ids),
                    CalendarEvent.visibility == EventVisibility.PRIVATE,
                    CalendarEvent.organizer_id != user_id,
                    ~CalendarEvent.id.in_(
                        select(EventAttendee.event_id).where(EventAttendee.user_id == user_id)
                    ),
                )
            )
        )
        return set(result.scalars().all())

    async def find_available_rooms(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_time: datetime,
        end_time: datetime,
        min_capacity: int | None = None,
        amenities: list[str] | None = None,
        room_type: RoomType | None = None,
    ) -> list[Room]:
        room_ops = RoomOperations(self.session)
        access_filter = await room_ops.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.ROOM,
            content_id_column=Room.id,
            owner_id_column=Room.owner_id,
            access_mode_column=Room.access_mode,
            baseline_role_column=Room.baseline_role,
        )
        return await queries.find_available_rooms(
            self.session,
            organization_id,
            start_time,
            end_time,
            access_filter,
            min_capacity=min_capacity,
            amenities=amenities,
            room_type=room_type,
        )

    async def get_booking_for_event(self, event_id: UUID) -> RoomBooking | None:
        return await queries.get_booking_for_event(self.session, event_id)

    async def cancel_booking_for_event(self, event_id: UUID) -> None:
        booking = await queries.get_booking_for_event(self.session, event_id)
        if booking is not None:
            booking.status = BookingStatus.CANCELLED
            booking.updated_at = datetime.now(UTC)
            await self.session.commit()
