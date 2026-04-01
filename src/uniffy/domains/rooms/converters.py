"""Proto <-> domain converters for rooms domain."""

from datetime import datetime
from uuid import UUID

from uniffy_proto.common.v1.common_pb2 import VisibilityScope as ProtoVisibilityScope
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

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.models.rooms.room import Room
from uniffy.core.models.shared import BookingStatus, RoomStatus, RoomType, VisibilityScope

# ---------------------------------------------------------------------------
# Enum mapping dicts (bidirectional)
# ---------------------------------------------------------------------------

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

VISIBILITY_TO_PROTO: dict[VisibilityScope, ProtoVisibilityScope.ValueType] = {
    VisibilityScope.PRIVATE: ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    VisibilityScope.GROUP: ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP,
    VisibilityScope.ORGANIZATION: ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION,
    VisibilityScope.PUBLIC: ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC,
}

VISIBILITY_FROM_PROTO: dict[ProtoVisibilityScope.ValueType, VisibilityScope] = {
    ProtoVisibilityScope.VISIBILITY_SCOPE_UNSPECIFIED: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP: VisibilityScope.GROUP,
    ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope.ORGANIZATION,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC: VisibilityScope.PUBLIC,
}


# ---------------------------------------------------------------------------
# Conversion functions
# ---------------------------------------------------------------------------


def room_type_from_proto(proto_type: ProtoRoomType.ValueType) -> RoomType:
    """Convert proto RoomType to model RoomType."""
    return ROOM_TYPE_FROM_PROTO.get(proto_type, RoomType.MEETING_ROOM)


def room_status_from_proto(proto_status: ProtoRoomStatus.ValueType) -> RoomStatus:
    """Convert proto RoomStatus to model RoomStatus."""
    return ROOM_STATUS_FROM_PROTO.get(proto_status, RoomStatus.ACTIVE)


def visibility_from_proto(proto_vis: ProtoVisibilityScope.ValueType) -> VisibilityScope:
    """Convert proto VisibilityScope to model VisibilityScope."""
    return VISIBILITY_FROM_PROTO.get(proto_vis, VisibilityScope.PRIVATE)


def room_to_proto(room: Room) -> ProtoRoom:
    """
    Convert Room model to proto Room message.

    Parameters
    ----------
    room : Room
        Room model instance.

    Returns
    -------
    ProtoRoom
        Proto message.

    """
    proto_room_type = ROOM_TYPE_TO_PROTO.get(
        room.room_type,
        ProtoRoomType.ROOM_TYPE_MEETING_ROOM,
    )
    proto_status = ROOM_STATUS_TO_PROTO.get(
        room.status,
        ProtoRoomStatus.ROOM_STATUS_ACTIVE,
    )
    proto_visibility = VISIBILITY_TO_PROTO.get(
        room.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
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
        visibility=proto_visibility,
        created_at=datetime_to_timestamp(room.created_at),
        updated_at=datetime_to_timestamp(room.updated_at),
    )

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
    """
    Convert RoomBooking model to proto RoomBooking message.

    Parameters
    ----------
    booking : RoomBooking
        Booking model instance.
    room_name : str
        Denormalized room display name for the response.
    booker_name : str
        Denormalized booker display name for the response.

    Returns
    -------
    ProtoRoomBooking
        Proto message.

    """
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
    """
    Convert availability slot data to proto TimeSlot message.

    Parameters
    ----------
    start_time : datetime
        Slot start time.
    end_time : datetime
        Slot end time.
    is_available : bool
        Whether the slot is available for booking.
    booking_id : UUID | None
        ID of the booking occupying this slot, if any.
    event_title : str
        Title of the event or booking in this slot.
    booker_name : str
        Display name of the person who booked this slot.

    Returns
    -------
    ProtoTimeSlot
        Proto message.

    """
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
