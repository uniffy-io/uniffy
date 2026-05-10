import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RoomType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROOM_TYPE_UNSPECIFIED: _ClassVar[RoomType]
    ROOM_TYPE_MEETING_ROOM: _ClassVar[RoomType]
    ROOM_TYPE_CONFERENCE_ROOM: _ClassVar[RoomType]
    ROOM_TYPE_OFFICE: _ClassVar[RoomType]
    ROOM_TYPE_OTHER: _ClassVar[RoomType]

class RoomStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROOM_STATUS_UNSPECIFIED: _ClassVar[RoomStatus]
    ROOM_STATUS_ACTIVE: _ClassVar[RoomStatus]
    ROOM_STATUS_MAINTENANCE: _ClassVar[RoomStatus]
    ROOM_STATUS_RETIRED: _ClassVar[RoomStatus]

class BookingStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    BOOKING_STATUS_UNSPECIFIED: _ClassVar[BookingStatus]
    BOOKING_STATUS_CONFIRMED: _ClassVar[BookingStatus]
    BOOKING_STATUS_CANCELLED: _ClassVar[BookingStatus]
ROOM_TYPE_UNSPECIFIED: RoomType
ROOM_TYPE_MEETING_ROOM: RoomType
ROOM_TYPE_CONFERENCE_ROOM: RoomType
ROOM_TYPE_OFFICE: RoomType
ROOM_TYPE_OTHER: RoomType
ROOM_STATUS_UNSPECIFIED: RoomStatus
ROOM_STATUS_ACTIVE: RoomStatus
ROOM_STATUS_MAINTENANCE: RoomStatus
ROOM_STATUS_RETIRED: RoomStatus
BOOKING_STATUS_UNSPECIFIED: BookingStatus
BOOKING_STATUS_CONFIRMED: BookingStatus
BOOKING_STATUS_CANCELLED: BookingStatus

class Room(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "name", "description", "room_type", "status", "capacity", "floor", "building", "location", "amenities", "image_file_id", "access_mode", "created_at", "updated_at", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ROOM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CAPACITY_FIELD_NUMBER: _ClassVar[int]
    FLOOR_FIELD_NUMBER: _ClassVar[int]
    BUILDING_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    AMENITIES_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    name: str
    description: str
    room_type: RoomType
    status: RoomStatus
    capacity: int
    floor: str
    building: str
    location: str
    amenities: _containers.RepeatedScalarFieldContainer[str]
    image_file_id: str
    access_mode: _common_pb2.AccessMode
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., room_type: _Optional[_Union[RoomType, str]] = ..., status: _Optional[_Union[RoomStatus, str]] = ..., capacity: _Optional[int] = ..., floor: _Optional[str] = ..., building: _Optional[str] = ..., location: _Optional[str] = ..., amenities: _Optional[_Iterable[str]] = ..., image_file_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class RoomBooking(_message.Message):
    __slots__ = ("id", "room_id", "organization_id", "user_id", "event_id", "title", "start_time", "end_time", "status", "notes", "booker_name", "room_name", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    BOOKER_NAME_FIELD_NUMBER: _ClassVar[int]
    ROOM_NAME_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    room_id: str
    organization_id: str
    user_id: str
    event_id: str
    title: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    status: BookingStatus
    notes: str
    booker_name: str
    room_name: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., room_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., event_id: _Optional[str] = ..., title: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status: _Optional[_Union[BookingStatus, str]] = ..., notes: _Optional[str] = ..., booker_name: _Optional[str] = ..., room_name: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class TimeSlot(_message.Message):
    __slots__ = ("start_time", "end_time", "is_available", "booking_id", "event_title", "booker_name")
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_AVAILABLE_FIELD_NUMBER: _ClassVar[int]
    BOOKING_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    BOOKER_NAME_FIELD_NUMBER: _ClassVar[int]
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_available: bool
    booking_id: str
    event_title: str
    booker_name: str
    def __init__(self, start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_available: _Optional[bool] = ..., booking_id: _Optional[str] = ..., event_title: _Optional[str] = ..., booker_name: _Optional[str] = ...) -> None: ...

class CreateRoomRequest(_message.Message):
    __slots__ = ("organization_id", "name", "description", "room_type", "capacity", "floor", "building", "location", "amenities", "image_file_id", "access_mode", "group_ids", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ROOM_TYPE_FIELD_NUMBER: _ClassVar[int]
    CAPACITY_FIELD_NUMBER: _ClassVar[int]
    FLOOR_FIELD_NUMBER: _ClassVar[int]
    BUILDING_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    AMENITIES_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    GROUP_IDS_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    room_type: RoomType
    capacity: int
    floor: str
    building: str
    location: str
    amenities: _containers.RepeatedScalarFieldContainer[str]
    image_file_id: str
    access_mode: _common_pb2.AccessMode
    group_ids: _containers.RepeatedScalarFieldContainer[str]
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., room_type: _Optional[_Union[RoomType, str]] = ..., capacity: _Optional[int] = ..., floor: _Optional[str] = ..., building: _Optional[str] = ..., location: _Optional[str] = ..., amenities: _Optional[_Iterable[str]] = ..., image_file_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., group_ids: _Optional[_Iterable[str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class GetRoomRequest(_message.Message):
    __slots__ = ("room_id", "organization_id")
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    room_id: str
    organization_id: str
    def __init__(self, room_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateRoomRequest(_message.Message):
    __slots__ = ("room_id", "organization_id", "name", "description", "room_type", "status", "capacity", "floor", "building", "location", "amenities", "image_file_id", "access_mode", "replace_amenities", "baseline_role")
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ROOM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CAPACITY_FIELD_NUMBER: _ClassVar[int]
    FLOOR_FIELD_NUMBER: _ClassVar[int]
    BUILDING_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    AMENITIES_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FILE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    REPLACE_AMENITIES_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    room_id: str
    organization_id: str
    name: str
    description: str
    room_type: RoomType
    status: RoomStatus
    capacity: int
    floor: str
    building: str
    location: str
    amenities: _containers.RepeatedScalarFieldContainer[str]
    image_file_id: str
    access_mode: _common_pb2.AccessMode
    replace_amenities: bool
    baseline_role: _common_pb2.ContentRole
    def __init__(self, room_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., room_type: _Optional[_Union[RoomType, str]] = ..., status: _Optional[_Union[RoomStatus, str]] = ..., capacity: _Optional[int] = ..., floor: _Optional[str] = ..., building: _Optional[str] = ..., location: _Optional[str] = ..., amenities: _Optional[_Iterable[str]] = ..., image_file_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., replace_amenities: _Optional[bool] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class DeleteRoomRequest(_message.Message):
    __slots__ = ("room_id", "organization_id", "permanent")
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    room_id: str
    organization_id: str
    permanent: bool
    def __init__(self, room_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., permanent: _Optional[bool] = ...) -> None: ...

class DeleteRoomResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class CreateRoomResponse(_message.Message):
    __slots__ = ("room",)
    ROOM_FIELD_NUMBER: _ClassVar[int]
    room: Room
    def __init__(self, room: _Optional[_Union[Room, _Mapping]] = ...) -> None: ...

class GetRoomResponse(_message.Message):
    __slots__ = ("room",)
    ROOM_FIELD_NUMBER: _ClassVar[int]
    room: Room
    def __init__(self, room: _Optional[_Union[Room, _Mapping]] = ...) -> None: ...

class UpdateRoomResponse(_message.Message):
    __slots__ = ("room",)
    ROOM_FIELD_NUMBER: _ClassVar[int]
    room: Room
    def __init__(self, room: _Optional[_Union[Room, _Mapping]] = ...) -> None: ...

class ListRoomsRequest(_message.Message):
    __slots__ = ("organization_id", "room_type", "status", "min_capacity", "amenities", "building", "floor", "search_query", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MIN_CAPACITY_FIELD_NUMBER: _ClassVar[int]
    AMENITIES_FIELD_NUMBER: _ClassVar[int]
    BUILDING_FIELD_NUMBER: _ClassVar[int]
    FLOOR_FIELD_NUMBER: _ClassVar[int]
    SEARCH_QUERY_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    room_type: RoomType
    status: RoomStatus
    min_capacity: int
    amenities: _containers.RepeatedScalarFieldContainer[str]
    building: str
    floor: str
    search_query: str
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., room_type: _Optional[_Union[RoomType, str]] = ..., status: _Optional[_Union[RoomStatus, str]] = ..., min_capacity: _Optional[int] = ..., amenities: _Optional[_Iterable[str]] = ..., building: _Optional[str] = ..., floor: _Optional[str] = ..., search_query: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListRoomsResponse(_message.Message):
    __slots__ = ("rooms", "total_count", "page", "page_size", "total_pages")
    ROOMS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    rooms: _containers.RepeatedCompositeFieldContainer[Room]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, rooms: _Optional[_Iterable[_Union[Room, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class CreateBookingRequest(_message.Message):
    __slots__ = ("organization_id", "room_id", "start_time", "end_time", "title", "notes", "event_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    room_id: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    title: str
    notes: str
    event_id: str
    def __init__(self, organization_id: _Optional[str] = ..., room_id: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., title: _Optional[str] = ..., notes: _Optional[str] = ..., event_id: _Optional[str] = ...) -> None: ...

class GetBookingRequest(_message.Message):
    __slots__ = ("booking_id", "organization_id")
    BOOKING_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    booking_id: str
    organization_id: str
    def __init__(self, booking_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class CancelBookingRequest(_message.Message):
    __slots__ = ("booking_id", "organization_id")
    BOOKING_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    booking_id: str
    organization_id: str
    def __init__(self, booking_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class CreateBookingResponse(_message.Message):
    __slots__ = ("booking",)
    BOOKING_FIELD_NUMBER: _ClassVar[int]
    booking: RoomBooking
    def __init__(self, booking: _Optional[_Union[RoomBooking, _Mapping]] = ...) -> None: ...

class GetBookingResponse(_message.Message):
    __slots__ = ("booking",)
    BOOKING_FIELD_NUMBER: _ClassVar[int]
    booking: RoomBooking
    def __init__(self, booking: _Optional[_Union[RoomBooking, _Mapping]] = ...) -> None: ...

class CancelBookingResponse(_message.Message):
    __slots__ = ("booking",)
    BOOKING_FIELD_NUMBER: _ClassVar[int]
    booking: RoomBooking
    def __init__(self, booking: _Optional[_Union[RoomBooking, _Mapping]] = ...) -> None: ...

class ListBookingsRequest(_message.Message):
    __slots__ = ("organization_id", "room_id", "user_id", "start_date", "end_date", "status", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    room_id: str
    user_id: str
    start_date: _timestamp_pb2.Timestamp
    end_date: _timestamp_pb2.Timestamp
    status: BookingStatus
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., room_id: _Optional[str] = ..., user_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status: _Optional[_Union[BookingStatus, str]] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListBookingsResponse(_message.Message):
    __slots__ = ("bookings", "total_count", "page", "page_size", "total_pages")
    BOOKINGS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    bookings: _containers.RepeatedCompositeFieldContainer[RoomBooking]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, bookings: _Optional[_Iterable[_Union[RoomBooking, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class CheckAvailabilityRequest(_message.Message):
    __slots__ = ("organization_id", "room_id", "start_date", "end_date")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    room_id: str
    start_date: _timestamp_pb2.Timestamp
    end_date: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., room_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CheckAvailabilityResponse(_message.Message):
    __slots__ = ("slots",)
    SLOTS_FIELD_NUMBER: _ClassVar[int]
    slots: _containers.RepeatedCompositeFieldContainer[TimeSlot]
    def __init__(self, slots: _Optional[_Iterable[_Union[TimeSlot, _Mapping]]] = ...) -> None: ...

class FindAvailableRoomsRequest(_message.Message):
    __slots__ = ("organization_id", "start_time", "end_time", "min_capacity", "amenities", "room_type")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    MIN_CAPACITY_FIELD_NUMBER: _ClassVar[int]
    AMENITIES_FIELD_NUMBER: _ClassVar[int]
    ROOM_TYPE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    min_capacity: int
    amenities: _containers.RepeatedScalarFieldContainer[str]
    room_type: RoomType
    def __init__(self, organization_id: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., min_capacity: _Optional[int] = ..., amenities: _Optional[_Iterable[str]] = ..., room_type: _Optional[_Union[RoomType, str]] = ...) -> None: ...

class FindAvailableRoomsResponse(_message.Message):
    __slots__ = ("rooms",)
    ROOMS_FIELD_NUMBER: _ClassVar[int]
    rooms: _containers.RepeatedCompositeFieldContainer[Room]
    def __init__(self, rooms: _Optional[_Iterable[_Union[Room, _Mapping]]] = ...) -> None: ...
