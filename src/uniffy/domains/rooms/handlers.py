from datetime import datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.rooms.v1.rooms_pb2 import (
    CancelBookingRequest,
    CancelBookingResponse,
    CheckAvailabilityRequest,
    CheckAvailabilityResponse,
    CreateBookingRequest,
    CreateBookingResponse,
    CreateRoomRequest,
    CreateRoomResponse,
    DeleteRoomRequest,
    DeleteRoomResponse,
    FindAvailableRoomsRequest,
    FindAvailableRoomsResponse,
    GetBookingRequest,
    GetBookingResponse,
    GetRoomRequest,
    GetRoomResponse,
    ListBookingsRequest,
    ListBookingsResponse,
    ListRoomsRequest,
    ListRoomsResponse,
    UpdateRoomRequest,
    UpdateRoomResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.rooms.converters import (
    BOOKING_STATUS_FROM_PROTO,
    booking_to_proto,
    room_status_from_proto,
    room_to_proto,
    room_type_from_proto,
    time_slot_to_proto,
)
from uniffy.domains.rooms.operations import BookingOperations, RoomOperations

logger = logger.bind(component="rooms.handlers")


async def _resolve_room_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    room: Room,
    checker: PermissionChecker | None = None,
):
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id,
        ContentType.ROOM,
    )
    return resolve_effective_policy(
        room.access_mode,
        room.baseline_role,
        default_mode,
        default_baseline,
    )


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class RoomHandlers:
    async def create_room(
        self,
        request: CreateRoomRequest,
        ctx: RequestContext,
    ) -> CreateRoomResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        group_ids = None
        if request.group_ids:
            group_ids = [_parse_uuid(gid, "group_id") for gid in request.group_ids]

        image_file_id = None
        if request.HasField("image_file_id"):
            image_file_id = _parse_uuid(request.image_file_id, "image_file_id")

        kwargs: dict = {
            "user_id": user_id,
            "organization_id": organization_id,
            "name": request.name,
            "room_type": room_type_from_proto(request.room_type),
            "capacity": request.capacity,
            "access_mode": access_mode,
            "baseline_role": baseline_role,
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
        if group_ids is not None:
            kwargs["group_ids"] = group_ids

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                room = await ops.create_room(**kwargs)
                eff_mode, eff_baseline = await _resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                return CreateRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_room", exc) from exc

    async def get_room(
        self,
        request: GetRoomRequest,
        ctx: RequestContext,
    ) -> GetRoomResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        room_id = _parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                room = await ops.get_by_id(user_id, organization_id, room_id)
                eff_mode, eff_baseline = await _resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                return GetRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_room", exc) from exc

    async def update_room(
        self,
        request: UpdateRoomRequest,
        ctx: RequestContext,
    ) -> UpdateRoomResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        room_id = _parse_uuid(request.room_id, "room_id")

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
            kwargs["image_file_id"] = _parse_uuid(request.image_file_id, "image_file_id")
        if request.replace_amenities:
            kwargs["amenities"] = list(request.amenities)

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                room = await ops.update_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    **kwargs,
                )
                eff_mode, eff_baseline = await _resolve_room_effective_policy(
                    session,
                    organization_id,
                    room,
                )
                return UpdateRoomResponse(
                    room=room_to_proto(
                        room,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_room", exc) from exc

    async def delete_room(
        self,
        request: DeleteRoomRequest,
        ctx: RequestContext,
    ) -> DeleteRoomResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        room_id = _parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
                await ops.delete_room(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    permanent=request.permanent,
                )
                message = "Room permanently deleted" if request.permanent else "Room deleted"
                return DeleteRoomResponse(success=True, message=message)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_room", exc) from exc

    async def list_rooms(
        self,
        request: ListRoomsRequest,
        ctx: RequestContext,
    ) -> ListRoomsResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        room_type = None
        if request.HasField("room_type"):
            room_type = room_type_from_proto(request.room_type)

        status = None
        if request.HasField("status"):
            status = room_status_from_proto(request.status)

        min_capacity = request.min_capacity if request.HasField("min_capacity") else None
        building = request.building if request.HasField("building") else None
        floor = request.floor if request.HasField("floor") else None
        search_query = request.search_query if request.HasField("search_query") else None

        try:
            async with open_session() as session:
                ops = RoomOperations(session)
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

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.ROOM,
                )
                proto_rooms = []
                for r in rooms:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        r.access_mode,
                        r.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_rooms.append(
                        room_to_proto(
                            r,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )

                return ListRoomsResponse(
                    rooms=proto_rooms,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_rooms", exc) from exc


class BookingHandlers:
    async def create_booking(
        self,
        request: CreateBookingRequest,
        ctx: RequestContext,
    ) -> CreateBookingResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        room_id = _parse_uuid(request.room_id, "room_id")

        event_id = None
        if request.HasField("event_id"):
            event_id = _parse_uuid(request.event_id, "event_id")

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
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

                room_name, booker_name = await _load_booking_names(session, booking.room_id, user_id)

                return CreateBookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_booking", exc) from exc

    async def get_booking(
        self,
        request: GetBookingRequest,
        ctx: RequestContext,
    ) -> GetBookingResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        booking_id = _parse_uuid(request.booking_id, "booking_id")

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
                booking = await ops.get_booking(user_id, organization_id, booking_id)
                room_name, booker_name = await _load_booking_names(
                    session, booking.room_id, booking.user_id
                )
                return GetBookingResponse(booking=booking_to_proto(booking, room_name, booker_name))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_booking", exc) from exc

    async def cancel_booking(
        self,
        request: CancelBookingRequest,
        ctx: RequestContext,
    ) -> CancelBookingResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        booking_id = _parse_uuid(request.booking_id, "booking_id")

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
                booking = await ops.cancel_booking(user_id, organization_id, booking_id)
                room_name, booker_name = await _load_booking_names(
                    session, booking.room_id, booking.user_id
                )
                return CancelBookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("cancel_booking", exc) from exc

    async def list_bookings(
        self,
        request: ListBookingsRequest,
        ctx: RequestContext,
    ) -> ListBookingsResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        room_id = None
        if request.HasField("room_id"):
            room_id = _parse_uuid(request.room_id, "room_id")

        start_date = None
        if request.HasField("start_date"):
            start_date = timestamp_to_datetime(request.start_date)

        end_date = None
        if request.HasField("end_date"):
            end_date = timestamp_to_datetime(request.end_date)

        status = None
        if request.HasField("status"):
            status = BOOKING_STATUS_FROM_PROTO.get(request.status)

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
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

                proto_bookings = [
                    booking_to_proto(booking, room_name, booker_name)
                    for booking, room_name, booker_name in bookings_with_names
                ]

                return ListBookingsResponse(
                    bookings=proto_bookings,
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_bookings", exc) from exc

    async def check_availability(
        self,
        request: CheckAvailabilityRequest,
        ctx: RequestContext,
    ) -> CheckAvailabilityResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        room_id = _parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
                slots = await ops.check_availability(
                    user_id=user_id,
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
        except Exception as exc:
            raise _map_domain_error("check_availability", exc) from exc

    async def find_available_rooms(
        self,
        request: FindAvailableRoomsRequest,
        ctx: RequestContext,
    ) -> FindAvailableRoomsResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        min_capacity = request.min_capacity if request.HasField("min_capacity") else None
        room_type = (
            room_type_from_proto(request.room_type) if request.HasField("room_type") else None
        )

        try:
            async with open_session() as session:
                ops = BookingOperations(session)
                rooms = await ops.find_available_rooms(
                    user_id=user_id,
                    organization_id=organization_id,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    min_capacity=min_capacity,
                    amenities=list(request.amenities) if request.amenities else None,
                    room_type=room_type,
                )

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.ROOM,
                )
                proto_rooms = []
                for r in rooms:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        r.access_mode,
                        r.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_rooms.append(
                        room_to_proto(
                            r,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                return FindAvailableRoomsResponse(rooms=proto_rooms)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("find_available_rooms", exc) from exc


async def _load_booking_names(
    session,
    room_id: UUID,
    booker_id: UUID,
) -> tuple[str, str]:
    room = (await session.execute(select(Room).where(Room.id == room_id))).scalar_one_or_none()
    room_name = room.name if room else ""

    user = (await session.execute(select(User).where(User.id == booker_id))).scalar_one_or_none()
    booker_name = (user.full_name or user.username) if user else ""

    return room_name, booker_name
