"""Proto <-> domain converters for the rooms domain."""

from datetime import datetime
from uuid import UUID

from uniffy_proto.rooms.v1.rooms_pb2 import (
    BookingStatus as ProtoBookingStatus,
)
from uniffy_proto.rooms.v1.rooms_pb2 import (
    Room as ProtoRoom,
)
from uniffy_proto.rooms.v1.rooms_pb2 import (
    RoomBooking as ProtoRoomBooking,
)
from uniffy_proto.rooms.v1.rooms_pb2 import (
    RoomStatus as ProtoRoomStatus,
)
from uniffy_proto.rooms.v1.rooms_pb2 import (
    RoomType as ProtoRoomType,
)
from uniffy_proto.rooms.v1.rooms_pb2 import (
    TimeSlot as ProtoTimeSlot,
)

from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, BookingStatus, ContentRole, RoomStatus, RoomType

# Domain-local enum maps. ``access_mode`` and ``content_role`` are shared
# across every domain so they live in ``core.converters.common_proto``.
ROOM_TYPE_TO_PROTO: dict[RoomType, ProtoRoomType.ValueType] = {
    RoomType.MEETING_ROOM: ProtoRoomType.ROOM_TYPE_MEETING_ROOM,
    RoomType.CONFERENCE_ROOM: ProtoRoomType.ROOM_TYPE_CONFERENCE_ROOM,
    RoomType.OFFICE: ProtoRoomType.ROOM_TYPE_OFFICE,
    RoomType.OTHER: ProtoRoomType.ROOM_TYPE_OTHER,
}

ROOM_TYPE_FROM_PROTO: dict[ProtoRoomType.ValueType, RoomType] = {
    ProtoRoomType.ROOM_TYPE_UNSPECIFIED: RoomType.MEETING_ROOM,
    ProtoRoomType.ROOM_TYPE_MEETING_ROOM: RoomType.MEETING_ROOM,
    ProtoRoomType.ROOM_TYPE_CONFERENCE_ROOM: RoomType.CONFERENCE_ROOM,
    ProtoRoomType.ROOM_TYPE_OFFICE: RoomType.OFFICE,
    ProtoRoomType.ROOM_TYPE_OTHER: RoomType.OTHER,
}

ROOM_STATUS_TO_PROTO: dict[RoomStatus, ProtoRoomStatus.ValueType] = {
    RoomStatus.ACTIVE: ProtoRoomStatus.ROOM_STATUS_ACTIVE,
    RoomStatus.MAINTENANCE: ProtoRoomStatus.ROOM_STATUS_MAINTENANCE,
    RoomStatus.RETIRED: ProtoRoomStatus.ROOM_STATUS_RETIRED,
}

ROOM_STATUS_FROM_PROTO: dict[ProtoRoomStatus.ValueType, RoomStatus] = {
    ProtoRoomStatus.ROOM_STATUS_UNSPECIFIED: RoomStatus.ACTIVE,
    ProtoRoomStatus.ROOM_STATUS_ACTIVE: RoomStatus.ACTIVE,
    ProtoRoomStatus.ROOM_STATUS_MAINTENANCE: RoomStatus.MAINTENANCE,
    ProtoRoomStatus.ROOM_STATUS_RETIRED: RoomStatus.RETIRED,
}

BOOKING_STATUS_TO_PROTO: dict[BookingStatus, ProtoBookingStatus.ValueType] = {
    BookingStatus.CONFIRMED: ProtoBookingStatus.BOOKING_STATUS_CONFIRMED,
    BookingStatus.CANCELLED: ProtoBookingStatus.BOOKING_STATUS_CANCELLED,
}

BOOKING_STATUS_FROM_PROTO: dict[ProtoBookingStatus.ValueType, BookingStatus] = {
    ProtoBookingStatus.BOOKING_STATUS_UNSPECIFIED: BookingStatus.CONFIRMED,
    ProtoBookingStatus.BOOKING_STATUS_CONFIRMED: BookingStatus.CONFIRMED,
    ProtoBookingStatus.BOOKING_STATUS_CANCELLED: BookingStatus.CANCELLED,
}


def room_type_from_proto(proto_type: ProtoRoomType.ValueType) -> RoomType:
    """Convert a proto RoomType to the domain enum."""
    return ROOM_TYPE_FROM_PROTO.get(proto_type, RoomType.MEETING_ROOM)


def room_status_from_proto(proto_status: ProtoRoomStatus.ValueType) -> RoomStatus:
    """Convert a proto RoomStatus to the domain enum."""
    return ROOM_STATUS_FROM_PROTO.get(proto_status, RoomStatus.ACTIVE)


def room_to_proto(
    room: Room,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> ProtoRoom:
    """Convert a :class:`Room` row to its proto representation."""
    proto_room_type = ROOM_TYPE_TO_PROTO.get(
        room.room_type,
        ProtoRoomType.ROOM_TYPE_MEETING_ROOM,
    )
    proto_status = ROOM_STATUS_TO_PROTO.get(
        room.status,
        ProtoRoomStatus.ROOM_STATUS_ACTIVE,
    )

    resolved_mode = effective_access_mode if effective_access_mode is not None else room.access_mode
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else room.baseline_role
    )

    proto_room = ProtoRoom(
        id=str(room.id),
        organization_id=str(room.organization_id),
        owner_id=str(room.owner_id),
        name=room.name,
        description=room.description,
        room_type=proto_room_type,
        status=proto_status,
        capacity=room.capacity,
        location=room.location,
        amenities=room.amenities or [],
        image_file_id=str(room.image_file_id) if room.image_file_id else "",
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        created_at=datetime_to_timestamp(room.created_at),
        updated_at=datetime_to_timestamp(room.updated_at),
    )

    if resolved_baseline is not None:
        proto_room.baseline_role = content_role_to_proto(resolved_baseline)

    if room.floor:
        proto_room.floor = room.floor

    if room.building:
        proto_room.building = room.building

    return proto_room


def booking_to_proto(
    booking: RoomBooking,
    room_name: str = "",
    booker_name: str = "",
) -> ProtoRoomBooking:
    """Convert a :class:`RoomBooking` to its proto representation."""
    proto_status = BOOKING_STATUS_TO_PROTO.get(
        booking.status,
        ProtoBookingStatus.BOOKING_STATUS_CONFIRMED,
    )

    proto_booking = ProtoRoomBooking(
        id=str(booking.id),
        room_id=str(booking.room_id),
        organization_id=str(booking.organization_id),
        user_id=str(booking.user_id),
        title=booking.title,
        start_time=datetime_to_timestamp(booking.start_time),
        end_time=datetime_to_timestamp(booking.end_time),
        status=proto_status,
        notes=booking.notes,
        booker_name=booker_name,
        room_name=room_name,
        created_at=datetime_to_timestamp(booking.created_at),
        updated_at=datetime_to_timestamp(booking.updated_at),
    )

    if booking.event_id:
        proto_booking.event_id = str(booking.event_id)

    return proto_booking


def time_slot_to_proto(
    start_time: datetime,
    end_time: datetime,
    is_available: bool,
    booking_id: UUID | None = None,
    event_title: str = "",
    booker_name: str = "",
) -> ProtoTimeSlot:
    """Convert availability-slot data to a ``TimeSlot`` proto."""
    proto_slot = ProtoTimeSlot(
        start_time=datetime_to_timestamp(start_time),
        end_time=datetime_to_timestamp(end_time),
        is_available=is_available,
        event_title=event_title,
        booker_name=booker_name,
    )

    if booking_id:
        proto_slot.booking_id = str(booking_id)

    return proto_slot
