"""Room and booking RPC handlers - thin layer delegating to operations."""

from datetime import datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.rooms.v1.rooms_pb2 import (
    BookingResponse,
    CancelBookingRequest,
    CheckAvailabilityRequest,
    CheckAvailabilityResponse,
    CreateBookingRequest,
    CreateRoomRequest,
    DeleteRoomRequest,
    DeleteRoomResponse,
    FindAvailableRoomsRequest,
    FindAvailableRoomsResponse,
    GetBookingRequest,
    GetRoomRequest,
    ListBookingsRequest,
    ListBookingsResponse,
    ListRoomsRequest,
    ListRoomsResponse,
    RoomResponse,
    UpdateRoomRequest,
)

from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.room import Room
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.rooms.converters import (
    BOOKING_STATUS_FROM_PROTO,
    booking_to_proto,
    room_status_from_proto,
    room_to_proto,
    room_type_from_proto,
    time_slot_to_proto,
    visibility_from_proto,
)
from uniffy.domains.rooms.operations import BookingOperations, RoomOperations


class RoomHandlers:
    """Room RPC handlers."""

    # Room CRUD

    async def create_room(
        self,
        request: CreateRoomRequest,
        ctx: RequestContext,
    ) -> RoomResponse:
        """Create a new room."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = RoomOperations(session)

                # Parse optional fields
                visibility = None
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                group_ids = None
                if request.group_ids:
                    group_ids = [UUID(gid) for gid in request.group_ids]

                image_file_id = None
                if request.HasField("image_file_id"):
                    try:
                        image_file_id = UUID(request.image_file_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid image_file_id")

                kwargs: dict = {
                    "user_id": user_id,
                    "organization_id": organization_id,
                    "name": request.name,
                    "room_type": room_type_from_proto(request.room_type),
                    "capacity": request.capacity,
                }

                if request.HasField("description"):
                    kwargs["description"] = request.description
                if request.HasField("floor"):
                    kwargs["floor"] = request.floor
                if request.HasField("building"):
                    kwargs["building"] = request.building
                if request.HasField("location"):
                    kwargs["location"] = request.location
                if request.amenities:
                    kwargs["amenities"] = list(request.amenities)
                if image_file_id is not None:
                    kwargs["image_file_id"] = image_file_id
                if visibility is not None:
                    kwargs["visibility"] = visibility
                if group_ids is not None:
                    kwargs["group_ids"] = group_ids

                room = await ops.create_room(**kwargs)
                return RoomResponse(room=room_to_proto(room))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating room: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_room(
        self,
        request: GetRoomRequest,
        ctx: RequestContext,
    ) -> RoomResponse:
        """Get a room by ID."""
        try:
            room_id = UUID(request.room_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = RoomOperations(session)
                room = await ops.get_by_id(user_id, organization_id, room_id)
                return RoomResponse(room=room_to_proto(room))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Room not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting room: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_room(
        self,
        request: UpdateRoomRequest,
        ctx: RequestContext,
    ) -> RoomResponse:
        """Update an existing room."""
        try:
            room_id = UUID(request.room_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = RoomOperations(session)

                # Build update kwargs from optional fields
                kwargs: dict = {}

                if request.HasField("name"):
                    kwargs["name"] = request.name
                if request.HasField("description"):
                    kwargs["description"] = request.description
                if request.HasField("room_type"):
                    kwargs["room_type"] = room_type_from_proto(request.room_type)
                if request.HasField("status"):
                    kwargs["status"] = room_status_from_proto(request.status)
                if request.HasField("capacity"):
                    kwargs["capacity"] = request.capacity
                if request.HasField("floor"):
                    kwargs["floor"] = request.floor
                if request.HasField("building"):
                    kwargs["building"] = request.building
                if request.HasField("location"):
                    kwargs["location"] = request.location
                if request.HasField("image_file_id"):
                    try:
                        kwargs["image_file_id"] = UUID(request.image_file_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid image_file_id")
                if request.HasField("visibility"):
                    kwargs["visibility"] = visibility_from_proto(request.visibility)

                # Handle amenities: only include if replace_amenities is True
                if request.replace_amenities:
                    kwargs["amenities"] = list(request.amenities)

                room = await ops.update_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    **kwargs,
                )

                return RoomResponse(room=room_to_proto(room))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Room not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating room: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_room(
        self,
        request: DeleteRoomRequest,
        ctx: RequestContext,
    ) -> DeleteRoomResponse:
        """Delete a room (soft or permanent)."""
        try:
            room_id = UUID(request.room_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = RoomOperations(session)
                await ops.delete_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    permanent=request.permanent,
                )

                message = "Room permanently deleted" if request.permanent else "Room deleted"
                return DeleteRoomResponse(success=True, message=message)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Room not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting room: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_rooms(
        self,
        request: ListRoomsRequest,
        ctx: RequestContext,
    ) -> ListRoomsResponse:
        """List rooms with filters and pagination."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = RoomOperations(session)

                # Parse optional filters
                room_type = None
                if request.HasField("room_type"):
                    room_type = room_type_from_proto(request.room_type)

                status = None
                if request.HasField("status"):
                    status = room_status_from_proto(request.status)

                min_capacity = None
                if request.HasField("min_capacity"):
                    min_capacity = request.min_capacity

                building = None
                if request.HasField("building"):
                    building = request.building

                floor = None
                if request.HasField("floor"):
                    floor = request.floor

                search_query = None
                if request.HasField("search_query"):
                    search_query = request.search_query

                rooms, total = await ops.list_rooms(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_type=room_type,
                    status=status,
                    min_capacity=min_capacity,
                    amenities=list(request.amenities) if request.amenities else None,
                    building=building,
                    floor=floor,
                    search_query=search_query,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                )

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                return ListRoomsResponse(
                    rooms=[room_to_proto(r) for r in rooms],
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing rooms: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")


class BookingHandlers:
    """Booking RPC handlers."""

    # Booking CRUD

    async def create_booking(
        self,
        request: CreateBookingRequest,
        ctx: RequestContext,
    ) -> BookingResponse:
        """Create a new room booking."""
        try:
            organization_id = UUID(request.organization_id)
            room_id = UUID(request.room_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)

                event_id = None
                if request.HasField("event_id"):
                    try:
                        event_id = UUID(request.event_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid event_id")

                booking = await ops.create_booking(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    title=request.title if request.HasField("title") else "",
                    notes=request.notes if request.HasField("notes") else "",
                    event_id=event_id,
                )

                # Fetch room name for proto response
                room = (
                    await session.execute(
                        select(Room).where(Room.id == booking.room_id)
                    )
                ).scalar_one_or_none()
                room_name = room.name if room else ""

                # Fetch booker display name for proto response
                user = (
                    await session.execute(
                        select(User).where(User.id == user_id)
                    )
                ).scalar_one_or_none()
                booker_name = user.full_name or user.username if user else ""

                return BookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating booking: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def get_booking(
        self,
        request: GetBookingRequest,
        ctx: RequestContext,
    ) -> BookingResponse:
        """Get a booking by ID."""
        try:
            booking_id = UUID(request.booking_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)
                booking = await ops.get_booking(user_id, organization_id, booking_id)

                # Fetch room name for proto response
                room = (
                    await session.execute(
                        select(Room).where(Room.id == booking.room_id)
                    )
                ).scalar_one_or_none()
                room_name = room.name if room else ""

                # Fetch booker display name for proto response
                user = (
                    await session.execute(
                        select(User).where(User.id == booking.user_id)
                    )
                ).scalar_one_or_none()
                booker_name = user.full_name or user.username if user else ""

                return BookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Booking not found")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting booking: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def cancel_booking(
        self,
        request: CancelBookingRequest,
        ctx: RequestContext,
    ) -> BookingResponse:
        """Cancel an existing booking."""
        try:
            booking_id = UUID(request.booking_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)
                booking = await ops.cancel_booking(user_id, organization_id, booking_id)

                # Fetch room name for proto response
                room = (
                    await session.execute(
                        select(Room).where(Room.id == booking.room_id)
                    )
                ).scalar_one_or_none()
                room_name = room.name if room else ""

                # Fetch booker display name for proto response
                user = (
                    await session.execute(
                        select(User).where(User.id == booking.user_id)
                    )
                ).scalar_one_or_none()
                booker_name = user.full_name or user.username if user else ""

                return BookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Booking not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error cancelling booking: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_bookings(
        self,
        request: ListBookingsRequest,
        ctx: RequestContext,
    ) -> ListBookingsResponse:
        """List bookings with filters and pagination."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)

                # Parse optional filters
                room_id = None
                if request.HasField("room_id"):
                    try:
                        room_id = UUID(request.room_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid room_id")

                start_date = None
                if request.HasField("start_date"):
                    start_date = timestamp_to_datetime(request.start_date)

                end_date = None
                if request.HasField("end_date"):
                    end_date = timestamp_to_datetime(request.end_date)

                status = None
                if request.HasField("status"):
                    status = BOOKING_STATUS_FROM_PROTO.get(request.status)

                bookings_with_names, total = await ops.list_bookings(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    start_date=start_date,
                    end_date=end_date,
                    status=status,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                )

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                proto_bookings = []
                for booking, room_name, booker_name in bookings_with_names:
                    proto_bookings.append(
                        booking_to_proto(booking, room_name, booker_name)
                    )

                return ListBookingsResponse(
                    bookings=proto_bookings,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing bookings: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    # Availability

    async def check_availability(
        self,
        request: CheckAvailabilityRequest,
        ctx: RequestContext,
    ) -> CheckAvailabilityResponse:
        """Check room availability for a date range."""
        try:
            organization_id = UUID(request.organization_id)
            room_id = UUID(request.room_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)
                slots = await ops.check_availability(
                    organization_id=organization_id,
                    room_id=room_id,
                    start_date=timestamp_to_datetime(request.start_date),
                    end_date=timestamp_to_datetime(request.end_date),
                )

                proto_slots = []
                for slot in slots:
                    booking_id = None
                    if slot.get("booking_id"):
                        booking_id = UUID(slot["booking_id"])

                    proto_slots.append(
                        time_slot_to_proto(
                            start_time=datetime.fromisoformat(slot["start_time"]),
                            end_time=datetime.fromisoformat(slot["end_time"]),
                            is_available=slot["is_available"],
                            booking_id=booking_id,
                            event_title=slot.get("event_title", ""),
                            booker_name=slot.get("booker_name", ""),
                        )
                    )

                return CheckAvailabilityResponse(slots=proto_slots)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error checking availability: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")

    async def find_available_rooms(
        self,
        request: FindAvailableRoomsRequest,
        ctx: RequestContext,
    ) -> FindAvailableRoomsResponse:
        """Find rooms available during a specific time range."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = BookingOperations(session)

                min_capacity = None
                if request.HasField("min_capacity"):
                    min_capacity = request.min_capacity

                room_type = None
                if request.HasField("room_type"):
                    room_type = room_type_from_proto(request.room_type)

                rooms = await ops.find_available_rooms(
                    organization_id=organization_id,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    min_capacity=min_capacity,
                    amenities=list(request.amenities) if request.amenities else None,
                    room_type=room_type,
                )

                return FindAvailableRoomsResponse(
                    rooms=[room_to_proto(r) for r in rooms]
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error finding available rooms: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {str(e)}")
