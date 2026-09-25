from datetime import datetime
from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.rooms.v1.rooms_pb import (
    CancelBookingRequest,
    CancelBookingResponse,
    CheckAvailabilityRequest,
    CheckAvailabilityResponse,
    CreateBookingRequest,
    CreateBookingResponse,
    FindAvailableRoomsRequest,
    FindAvailableRoomsResponse,
    GetBookingRequest,
    GetBookingResponse,
    ListBookingsRequest,
    ListBookingsResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.scheduling.rooms.bookings import BookingOperations
from uniffy.domains.scheduling.rooms.converters import (
    BOOKING_STATUS_FROM_PROTO,
    booking_to_proto,
    room_to_proto,
    room_type_from_proto,
    time_slot_to_proto,
)
from uniffy.domains.scheduling.rooms.rpc.support import (
    load_booking_names,
    map_domain_error,
    parse_uuid,
)
from uniffy.infrastructure.database import open_session


class BookingHandlers:
    async def create_booking(
        self,
        request: CreateBookingRequest,
        ctx: RequestContext,
    ) -> CreateBookingResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id")
        event_id = (
            parse_uuid(request.event_id, "event_id") if request.has_field("event_id") else None
        )

        try:
            async with open_session() as session:
                booking = await BookingOperations(session).create_booking(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    title=request.title if request.has_field("title") else "",
                    notes=request.notes if request.has_field("notes") else "",
                    event_id=event_id,
                )
                room_name, booker_name = await load_booking_names(session, booking.room_id, user_id)
                return CreateBookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_booking", exc) from exc

    async def get_booking(
        self,
        request: GetBookingRequest,
        ctx: RequestContext,
    ) -> GetBookingResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        booking_id = parse_uuid(request.booking_id, "booking_id")

        try:
            async with open_session() as session:
                booking = await BookingOperations(session).get_booking(
                    user_id, organization_id, booking_id
                )
                room_name, booker_name = await load_booking_names(
                    session, booking.room_id, booking.user_id
                )
                return GetBookingResponse(booking=booking_to_proto(booking, room_name, booker_name))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_booking", exc) from exc

    async def cancel_booking(
        self,
        request: CancelBookingRequest,
        ctx: RequestContext,
    ) -> CancelBookingResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        booking_id = parse_uuid(request.booking_id, "booking_id")

        try:
            async with open_session() as session:
                booking = await BookingOperations(session).cancel_booking(
                    user_id, organization_id, booking_id
                )
                room_name, booker_name = await load_booking_names(
                    session, booking.room_id, booking.user_id
                )
                return CancelBookingResponse(
                    booking=booking_to_proto(booking, room_name, booker_name)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("cancel_booking", exc) from exc

    async def list_bookings(
        self,
        request: ListBookingsRequest,
        ctx: RequestContext,
    ) -> ListBookingsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id") if request.has_field("room_id") else None
        start_date = (
            timestamp_to_datetime(request.start_date) if request.has_field("start_date") else None
        )
        end_date = timestamp_to_datetime(request.end_date) if request.has_field("end_date") else None
        status = (
            BOOKING_STATUS_FROM_PROTO.get(request.status) if request.has_field("status") else None
        )

        try:
            async with open_session() as session:
                bookings_with_names, total = await BookingOperations(session).list_bookings(
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
                return ListBookingsResponse(
                    bookings=[
                        booking_to_proto(booking, room_name, booker_name)
                        for booking, room_name, booker_name in bookings_with_names
                    ],
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=(total + page_size - 1) // page_size,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_bookings", exc) from exc

    async def check_availability(
        self,
        request: CheckAvailabilityRequest,
        ctx: RequestContext,
    ) -> CheckAvailabilityResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        room_id = parse_uuid(request.room_id, "room_id")

        try:
            async with open_session() as session:
                slots = await BookingOperations(session).check_availability(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    start_date=timestamp_to_datetime(request.start_date),
                    end_date=timestamp_to_datetime(request.end_date),
                )
                proto_slots = []
                for slot in slots:
                    booking_id = UUID(slot["booking_id"]) if slot.get("booking_id") else None
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
            raise map_domain_error("check_availability", exc) from exc

    async def find_available_rooms(
        self,
        request: FindAvailableRoomsRequest,
        ctx: RequestContext,
    ) -> FindAvailableRoomsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        min_capacity = request.min_capacity if request.has_field("min_capacity") else None
        room_type = (
            room_type_from_proto(request.room_type) if request.has_field("room_type") else None
        )

        try:
            async with open_session() as session:
                rooms = await BookingOperations(session).find_available_rooms(
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
                decisions = await ResourceAccessResolver(session).resolve_page(
                    actor_id=user_id,
                    organization_id=organization_id,
                    keys=[ResourceKey(ContentType.ROOM, room.id) for room in rooms],
                )
                proto_rooms = []
                for room in rooms:
                    effective_mode, effective_baseline = resolve_effective_policy(
                        room.access_mode,
                        room.baseline_role,
                        default_mode,
                        default_baseline,
                    )
                    proto_rooms.append(
                        room_to_proto(
                            room,
                            effective_access_mode=effective_mode,
                            effective_baseline_role=effective_baseline,
                            user_role=decisions[ResourceKey(ContentType.ROOM, room.id)].role,
                        )
                    )
                return FindAvailableRoomsResponse(rooms=proto_rooms)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("find_available_rooms", exc) from exc
