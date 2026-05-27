from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_content_loader,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    BookingStatus,
    ContentRole,
    ContentType,
    RoomStatus,
    RoomType,
    SubjectType,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.rooms import queries


class RoomOperations(BaseContentOperations[Room]):
    content_type = ContentType.ROOM
    model_class = Room

    def _build_search_keywords(self, model: Room) -> str:
        parts = [model.name]
        if model.description:
            parts.append(model.description)
        if model.location:
            parts.append(model.location)
        if model.building:
            parts.append(model.building)
        if model.floor:
            parts.append(model.floor)
        if model.amenities:
            parts.extend(model.amenities)
        return " ".join(parts)

    def _get_search_title(self, model: Room) -> str:
        return model.name

    def _get_url_path(self, model: Room) -> str:
        return f"/rooms/{model.id}"

    def _get_search_description(self, model: Room) -> str | None:
        if model.description:
            return model.description[:200]
        if model.location:
            return model.location
        return None

    def _get_search_metadata(self, model: Room) -> dict[str, str] | None:
        metadata: dict[str, str] = {
            "room_type": model.room_type.value,
            "capacity": str(model.capacity),
        }
        if model.building:
            metadata["building"] = model.building
        return metadata

    async def create_room(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        description: str = "",
        room_type: RoomType = RoomType.MEETING_ROOM,
        capacity: int = 0,
        floor: str | None = None,
        building: str | None = None,
        location: str = "",
        amenities: list[str] | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
        image_file_id: UUID | None = None,
    ) -> Room:
        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        room = Room(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=description,
            room_type=room_type,
            capacity=capacity,
            floor=floor,
            building=building,
            location=location,
            amenities=amenities,
            image_file_id=image_file_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )
        self.session.add(room)
        await self.session.commit()
        await self.session.refresh(room)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.ROOM_CREATED,
            resource_type=ContentType.ROOM.value,
            resource_id=room.id,
            details={"name": room.name, "room_type": room_type.value},
        )
        await self.session.commit()

        if group_ids:
            members_ops = ContentMembersOperations(self.session)
            for gid in group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=room.id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        await self._index_for_search(room, skip_member_lookup=not group_ids)
        await self.session.commit()

        return room

    async def update_room(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        name: str | None = None,
        description: str | None = None,
        room_type: RoomType | None = None,
        capacity: int | None = None,
        floor: str | None = None,
        building: str | None = None,
        location: str | None = None,
        amenities: list[str] | None = None,
        status: RoomStatus | None = None,
        image_file_id: UUID | None = None,
    ) -> Room:
        # Access-policy changes go through permissions.v1.MembersService, not this method.
        room = await self.get_by_id(user_id, organization_id, room_id)
        await self._require_edit(user_id, organization_id, room)

        changed_keys: list[str] = []
        was_active = room.status != RoomStatus.RETIRED if room.status else True
        if name is not None and room.name != name:
            room.name = name
            changed_keys.append("name")
        if description is not None and room.description != description:
            room.description = description
            changed_keys.append("description")
        if room_type is not None and room.room_type != room_type:
            room.room_type = room_type
            changed_keys.append("room_type")
        if capacity is not None and room.capacity != capacity:
            room.capacity = capacity
            changed_keys.append("capacity")
        if floor is not None and room.floor != floor:
            room.floor = floor
            changed_keys.append("floor")
        if building is not None and room.building != building:
            room.building = building
            changed_keys.append("building")
        if location is not None and room.location != location:
            room.location = location
            changed_keys.append("location")
        if amenities is not None and room.amenities != amenities:
            room.amenities = amenities
            changed_keys.append("amenities")
        if status is not None and room.status != status:
            room.status = status
            changed_keys.append("status")
        if image_file_id is not None and room.image_file_id != image_file_id:
            room.image_file_id = image_file_id
            changed_keys.append("image_file_id")

        room.updated_at = datetime.now(UTC)

        if changed_keys:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=(
                    Action.ROOM_ARCHIVED
                    if status == RoomStatus.RETIRED and was_active
                    else Action.ROOM_UPDATED
                ),
                resource_type=ContentType.ROOM.value,
                resource_id=room_id,
                details={"changed_keys": changed_keys},
            )

        await self.session.commit()
        await self.session.refresh(room)

        await self._index_for_search(room)
        await self.session.commit()

        return room

    async def delete_room(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        permanent: bool = False,
    ) -> None:
        # Refuses to delete rooms with future CONFIRMED bookings.
        room = await self.get_by_id(user_id, organization_id, room_id)
        await self._require_delete(user_id, organization_id, room)

        now = datetime.now(UTC)
        future_count_result = await self.session.execute(
            select(func.count()).where(
                and_(
                    RoomBooking.room_id == room_id,
                    RoomBooking.status == BookingStatus.CONFIRMED,
                    RoomBooking.end_time > now,
                )
            )
        )
        future_count = future_count_result.scalar() or 0
        if future_count > 0:
            raise ValidationError(
                "room",
                f"Cannot delete room with {future_count} future confirmed booking(s). "
                "Cancel the bookings first.",
            )

        if permanent:
            await self.session.delete(room)
        else:
            room.is_deleted = True
            room.deleted_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.ROOM_DELETED,
            resource_type=ContentType.ROOM.value,
            resource_id=room_id,
            details={"name": room.name, "permanent": permanent},
        )

        await self.session.commit()

        await self.search_indexer.remove(
            build_content_urn(self.content_type, room_id), organization_id
        )
        await self.session.commit()

    async def list_rooms(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_type: RoomType | None = None,
        status: RoomStatus | None = None,
        min_capacity: int | None = None,
        amenities: list[str] | None = None,
        building: str | None = None,
        floor: str | None = None,
        search_query: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Room], int]:
        query = select(Room).where(
            Room.organization_id == organization_id,
            Room.is_deleted == False,  # noqa: E712
        )

        is_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
        if not is_admin:
            is_admin = await self.permission_checker.is_domain_admin(
                user_id, organization_id, self.content_type
            )

        if not is_admin:
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Room.id,
                owner_id_column=Room.owner_id,
                access_mode_column=Room.access_mode,
                baseline_role_column=Room.baseline_role,
            )
            query = query.where(access_filter)

        if status is not None:
            query = query.where(Room.status == status)
        if room_type is not None:
            query = query.where(Room.room_type == room_type)
        if min_capacity is not None:
            query = query.where(Room.capacity >= min_capacity)
        if amenities:
            query = query.where(Room.amenities.contains(amenities))
        if building is not None:
            query = query.where(Room.building == building)
        if floor is not None:
            query = query.where(Room.floor == floor)
        if search_query:
            pattern = f"%{search_query}%"
            query = query.where(
                Room.name.ilike(pattern)
                | Room.description.ilike(pattern)
                | Room.building.ilike(pattern)
                | Room.floor.ilike(pattern)
                | Room.location.ilike(pattern)
            )

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = query.order_by(Room.name.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        rooms = list(result.scalars().all())

        return rooms, total


class BookingOperations:
    """Room booking operations (not content-indexed)."""

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
        room_ops = RoomOperations(self.session)
        room = await room_ops.get_by_id(user_id, organization_id, room_id)
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
        await self.session.commit()
        await self.session.refresh(booking)

        return booking

    async def cancel_booking(
        self,
        user_id: UUID,
        organization_id: UUID,
        booking_id: UUID,
    ) -> RoomBooking:
        # Booker or org admin only.
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
            org_ops = OrganizationOperations(self.session)
            membership = await org_ops.require_org_member(user_id, organization_id)
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
        access_filter = room_ops.access_query.build_accessible_filter(
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

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = query.order_by(RoomBooking.start_time.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        rows = result.all()

        bookings: list[tuple[RoomBooking, str, str]] = []
        for booking, room_name, booker_name in rows:
            bookings.append((booking, room_name or "", booker_name or ""))

        return bookings, total

    async def check_availability(
        self,
        organization_id: UUID,
        room_id: UUID,
        start_date: datetime,
        end_date: datetime,
    ) -> list[dict]:
        booking_rows = await queries.get_room_bookings_in_range(
            self.session,
            room_id,
            start_date,
            end_date,
        )

        slots: list[dict] = []
        for booking, booker_name in booking_rows:
            slots.append({
                "start_time": booking.start_time.isoformat(),
                "end_time": booking.end_time.isoformat(),
                "is_available": False,
                "booking_id": str(booking.id),
                "event_title": booking.title,
                "booker_name": booker_name,
            })

        return slots

    async def find_available_rooms(
        self,
        organization_id: UUID,
        start_time: datetime,
        end_time: datetime,
        min_capacity: int | None = None,
        amenities: list[str] | None = None,
        room_type: RoomType | None = None,
    ) -> list[Room]:
        return await queries.find_available_rooms(
            self.session,
            organization_id,
            start_time,
            end_time,
            min_capacity=min_capacity,
            amenities=amenities,
            room_type=room_type,
        )

    async def get_booking_for_event(
        self,
        event_id: UUID,
    ) -> RoomBooking | None:
        return await queries.get_booking_for_event(self.session, event_id)

    async def cancel_booking_for_event(
        self,
        event_id: UUID,
    ) -> None:
        booking = await queries.get_booking_for_event(self.session, event_id)
        if booking is not None:
            booking.status = BookingStatus.CANCELLED
            booking.updated_at = datetime.now(UTC)
            await self.session.commit()


async def _load_room(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Room | None:
    result = await session.execute(
        select(Room).where(
            Room.id == content_id,
            Room.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.ROOM, _load_room)
