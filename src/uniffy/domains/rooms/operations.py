"""Room and booking operations with permissions and search indexing."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.models.shared import (
    BookingStatus,
    ContentType,
    RoomStatus,
    RoomType,
    VisibilityScope,
)
from uniffy.core.search.indexer import build_content_urn
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.rooms import queries


class RoomOperations(BaseContentOperations[Room]):
    """
    Room CRUD operations with permissions and search indexing.

    Extends BaseContentOperations to provide room-specific functionality
    including filtered listing, capacity search, and soft deletion
    with booking safety checks.
    """

    content_type = ContentType.ROOM
    model_class = Room

    def __init__(self, session: AsyncSession) -> None:
        """Initialize room operations."""
        super().__init__(session)

    # Search index hooks

    def _build_search_keywords(self, model: Room) -> str:
        """
        Build search keywords from room attributes.

        Combines name, description, location, building, floor, and
        amenities into a single searchable string.

        Parameters
        ----------
        model : Room
            The room model.

        Returns
        -------
        str
            Keywords string for search indexing.

        """
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
        """Get room name for search index."""
        return model.name

    def _get_url_path(self, model: Room) -> str:
        """Get URL path for room search results."""
        return f"/rooms/{model.id}"

    def _get_search_description(self, model: Room) -> str | None:
        """
        Get search description from room.

        Falls back to location when no description is set.

        Parameters
        ----------
        model : Room
            The room model.

        Returns
        -------
        str | None
            Description for search results, or None.

        """
        if model.description:
            return model.description[:200]
        if model.location:
            return model.location
        return None

    def _get_search_metadata(self, model: Room) -> dict[str, str] | None:
        """
        Get room metadata for search index.

        Parameters
        ----------
        model : Room
            The room model.

        Returns
        -------
        dict[str, str] | None
            Metadata dict with room_type, capacity, and building.

        """
        metadata: dict[str, str] = {
            "room_type": model.room_type.value,
            "capacity": str(model.capacity),
        }
        if model.building:
            metadata["building"] = model.building
        return metadata

    # Room CRUD

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
        visibility: VisibilityScope = VisibilityScope.ORGANIZATION,
        group_ids: list[UUID] | None = None,
        image_file_id: UUID | None = None,
    ) -> Room:
        """
        Create a new room.

        Parameters
        ----------
        user_id : UUID
            User creating the room.
        organization_id : UUID
            Organization scope.
        name : str
            Room display name.
        description : str
            Room description in markdown.
        room_type : RoomType
            Type of room or resource.
        capacity : int
            Maximum occupancy.
        floor : str | None
            Floor identifier.
        building : str | None
            Building name.
        location : str
            Human-readable location.
        amenities : list[str] | None
            Available amenities.
        visibility : VisibilityScope
            Who can see and book this room.
        group_ids : list[UUID] | None
            Groups to share with (for GROUP visibility).
        image_file_id : UUID | None
            Optional photo of the room.

        Returns
        -------
        Room
            The created room.

        """
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
            visibility=visibility,
        )
        self.session.add(room)
        await self.session.flush()

        # Create group links if visibility is GROUP
        if visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(
                content_id=room.id,
                organization_id=organization_id,
                user_id=user_id,
                group_ids=group_ids,
            )

        await self.session.commit()
        await self.session.refresh(room)

        # Index for search
        await self._index_for_search(
            model=room,
            group_ids=group_ids if visibility == VisibilityScope.GROUP else [],
        )
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
        visibility: VisibilityScope | None = None,
        image_file_id: UUID | None = None,
    ) -> Room:
        """
        Update an existing room.

        Parameters
        ----------
        user_id : UUID
            User performing the update.
        organization_id : UUID
            Organization scope.
        room_id : UUID
            Room to update.
        name : str | None
            New name (None = no change).
        description : str | None
            New description (None = no change).
        room_type : RoomType | None
            New room type (None = no change).
        capacity : int | None
            New capacity (None = no change).
        floor : str | None
            New floor (None = no change).
        building : str | None
            New building (None = no change).
        location : str | None
            New location (None = no change).
        amenities : list[str] | None
            New amenities list (None = no change).
        status : RoomStatus | None
            New operational status (None = no change).
        visibility : VisibilityScope | None
            New visibility scope (None = no change).
        image_file_id : UUID | None
            New image file ID (None = no change).

        Returns
        -------
        Room
            The updated room.

        Raises
        ------
        NotFoundError
            If room does not exist.
        PermissionDeniedError
            If user cannot edit the room.

        """
        room = await self.get_by_id(user_id, organization_id, room_id)
        await self._require_edit(user_id, organization_id, room)

        if name is not None:
            room.name = name
        if description is not None:
            room.description = description
        if room_type is not None:
            room.room_type = room_type
        if capacity is not None:
            room.capacity = capacity
        if floor is not None:
            room.floor = floor
        if building is not None:
            room.building = building
        if location is not None:
            room.location = location
        if amenities is not None:
            room.amenities = amenities
        if status is not None:
            room.status = status
        if visibility is not None:
            room.visibility = visibility
        if image_file_id is not None:
            room.image_file_id = image_file_id

        room.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(room)

        # Re-index for search
        group_ids = await self._get_content_group_ids(room.id)
        await self._index_for_search(model=room, group_ids=group_ids)
        await self.session.commit()

        return room

    async def delete_room(
        self,
        user_id: UUID,
        organization_id: UUID,
        room_id: UUID,
        permanent: bool = False,
    ) -> None:
        """
        Delete a room (soft delete by default).

        Checks for future CONFIRMED bookings before deleting. If any exist,
        raises a ValidationError to prevent data loss.

        Parameters
        ----------
        user_id : UUID
            User performing the deletion.
        organization_id : UUID
            Organization scope.
        room_id : UUID
            Room to delete.
        permanent : bool
            If True, permanently delete the room.

        Raises
        ------
        NotFoundError
            If room does not exist.
        PermissionDeniedError
            If user cannot delete the room.
        ValidationError
            If room has future confirmed bookings.

        """
        room = await self.get_by_id(user_id, organization_id, room_id)
        await self._require_delete(user_id, organization_id, room)

        # Check for future confirmed bookings
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

        await self.session.commit()

        # Remove from search index
        await self.search_indexer.remove(build_content_urn(self.content_type, room_id))
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
        """
        List rooms with filters and pagination.

        Returns only ACTIVE, non-deleted rooms by default. Results are
        permission-filtered so the user only sees rooms they can access.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization scope.
        room_type : RoomType | None
            Filter by room type.
        status : RoomStatus | None
            Filter by operational status (defaults to ACTIVE only).
        min_capacity : int | None
            Minimum capacity filter.
        amenities : list[str] | None
            Required amenities (room must contain all listed).
        building : str | None
            Filter by building name.
        floor : str | None
            Filter by floor identifier.
        search_query : str | None
            Free-text search on name and description.
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[Room], int]
            List of rooms and total count.

        """
        # Build permission-aware base query
        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Room.id,
            owner_id_column=Room.owner_id,
            visibility_column=Room.visibility,
        )

        query = (
            select(Room)
            .where(Room.organization_id == organization_id)
            .where(Room.is_deleted == False)  # noqa: E712
            .where(access_filter)
        )

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

        # Count total matching
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort and paginate
        query = query.order_by(Room.name.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        rooms = list(result.scalars().all())

        return rooms, total


class BookingOperations:
    """
    Room booking operations.

    Handles booking creation, cancellation, availability checks, and
    conflict detection. Does not extend BaseContentOperations because
    bookings are not searchable content items.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize booking operations."""
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
        """
        Create a room booking after conflict validation.

        Parameters
        ----------
        user_id : UUID
            User making the booking.
        organization_id : UUID
            Organization scope.
        room_id : UUID
            Room to book.
        start_time : datetime
            Booking start time.
        end_time : datetime
            Booking end time.
        title : str
            Booking title.
        notes : str
            Additional notes.
        event_id : UUID | None
            Optional linked calendar event.

        Returns
        -------
        RoomBooking
            The created booking.

        Raises
        ------
        NotFoundError
            If room does not exist or is not active.
        ValidationError
            If room is already booked for the requested time slot.

        """
        # Verify room exists, is accessible, and is active
        room_ops = RoomOperations(self.session)
        room = await room_ops.get_by_id(user_id, organization_id, room_id)
        if room.status != RoomStatus.ACTIVE:
            raise ValidationError(
                "room",
                f"Room '{room.name}' is not available for booking (status: {room.status.value}).",
            )

        # Check for conflicts
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
        """
        Cancel an existing booking.

        The booking can be cancelled by the user who made it or by an
        organization admin.

        Parameters
        ----------
        user_id : UUID
            User performing the cancellation.
        organization_id : UUID
            Organization scope.
        booking_id : UUID
            Booking to cancel.

        Returns
        -------
        RoomBooking
            The cancelled booking.

        Raises
        ------
        NotFoundError
            If booking does not exist.
        PermissionDeniedError
            If user is not the booker and not an org admin.

        """
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

        # Verify permission: must be the booker or an org admin
        if booking.user_id != user_id:
            org_ops = OrganizationOperations(self.session)
            membership = await org_ops.require_org_member(user_id, organization_id)
            if membership.role not in ("ADMIN", "OWNER"):
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
        """
        Get a single booking by ID.

        Parameters
        ----------
        user_id : UUID
            User requesting the booking.
        organization_id : UUID
            Organization scope.
        booking_id : UUID
            Booking ID.

        Returns
        -------
        RoomBooking
            The requested booking.

        Raises
        ------
        NotFoundError
            If booking does not exist in the organization.

        """
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
        """
        List bookings with optional filters, joined with room and user names.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization scope.
        room_id : UUID | None
            Filter by room.
        start_date : datetime | None
            Only include bookings overlapping after this time.
        end_date : datetime | None
            Only include bookings overlapping before this time.
        status : BookingStatus | None
            Filter by booking status.
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[tuple[RoomBooking, str, str]], int]
            List of (booking, room_name, booker_name) tuples and total count.

        """
        booker = aliased(User)

        # Filter bookings to only include rooms the user can access
        room_ops = RoomOperations(self.session)
        access_filter = room_ops.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.ROOM,
            content_id_column=Room.id,
            owner_id_column=Room.owner_id,
            visibility_column=Room.visibility,
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

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort and paginate
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
        """
        Check room availability for a date range.

        Returns a list of time slots with booking information, allowing
        the frontend to render an availability timeline.

        Parameters
        ----------
        organization_id : UUID
            Organization scope.
        room_id : UUID
            Room to check.
        start_date : datetime
            Start of the range.
        end_date : datetime
            End of the range.

        Returns
        -------
        list[dict]
            List of dicts with keys: start_time, end_time, is_available,
            booking_id, event_title, booker_name.

        """
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
        """
        Find rooms available during a specific time range.

        Parameters
        ----------
        organization_id : UUID
            Organization scope.
        start_time : datetime
            Desired start time.
        end_time : datetime
            Desired end time.
        min_capacity : int | None
            Minimum room capacity.
        amenities : list[str] | None
            Required amenities.
        room_type : RoomType | None
            Required room type.

        Returns
        -------
        list[Room]
            Available rooms matching the criteria.

        """
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
        """
        Get the confirmed booking linked to a calendar event.

        Parameters
        ----------
        event_id : UUID
            Calendar event ID.

        Returns
        -------
        RoomBooking | None
            The linked booking, or None if no booking exists for the event.

        """
        return await queries.get_booking_for_event(self.session, event_id)

    async def cancel_booking_for_event(
        self,
        event_id: UUID,
    ) -> None:
        """
        Cancel any confirmed booking linked to a calendar event.

        This is used when a calendar event with a room booking is deleted
        or modified to no longer need a room.

        Parameters
        ----------
        event_id : UUID
            Calendar event ID.

        """
        booking = await queries.get_booking_for_event(self.session, event_id)
        if booking is not None:
            booking.status = BookingStatus.CANCELLED
            booking.updated_at = datetime.now(UTC)
            await self.session.commit()
