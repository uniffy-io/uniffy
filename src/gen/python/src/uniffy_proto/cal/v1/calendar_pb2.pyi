import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
from tags.v1 import tags_pb2 as _tags_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RecurrencePattern(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RECURRENCE_PATTERN_UNSPECIFIED: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_NONE: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_DAILY: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_WEEKLY: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_BIWEEKLY: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_MONTHLY: _ClassVar[RecurrencePattern]
    RECURRENCE_PATTERN_YEARLY: _ClassVar[RecurrencePattern]

class DayOfWeek(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DAY_OF_WEEK_UNSPECIFIED: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_MONDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_TUESDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_WEDNESDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_THURSDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_FRIDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_SATURDAY: _ClassVar[DayOfWeek]
    DAY_OF_WEEK_SUNDAY: _ClassVar[DayOfWeek]

class AttendeeStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ATTENDEE_STATUS_UNSPECIFIED: _ClassVar[AttendeeStatus]
    ATTENDEE_STATUS_PENDING: _ClassVar[AttendeeStatus]
    ATTENDEE_STATUS_ACCEPTED: _ClassVar[AttendeeStatus]
    ATTENDEE_STATUS_TENTATIVE: _ClassVar[AttendeeStatus]
    ATTENDEE_STATUS_DECLINED: _ClassVar[AttendeeStatus]

class AttendeeRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ATTENDEE_ROLE_UNSPECIFIED: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_ORGANIZER: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_REQUIRED: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_OPTIONAL: _ClassVar[AttendeeRole]

class CalendarType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CALENDAR_TYPE_UNSPECIFIED: _ClassVar[CalendarType]
    CALENDAR_TYPE_PERSONAL: _ClassVar[CalendarType]
    CALENDAR_TYPE_WORK: _ClassVar[CalendarType]
    CALENDAR_TYPE_TEAM: _ClassVar[CalendarType]
    CALENDAR_TYPE_SHARED: _ClassVar[CalendarType]

class ResourceType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RESOURCE_TYPE_UNSPECIFIED: _ClassVar[ResourceType]
    RESOURCE_TYPE_NOTE: _ClassVar[ResourceType]
    RESOURCE_TYPE_FILE: _ClassVar[ResourceType]
    RESOURCE_TYPE_CHAT: _ClassVar[ResourceType]

class RecurrenceEditScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RECURRENCE_EDIT_SCOPE_UNSPECIFIED: _ClassVar[RecurrenceEditScope]
    RECURRENCE_EDIT_SCOPE_THIS_EVENT: _ClassVar[RecurrenceEditScope]
    RECURRENCE_EDIT_SCOPE_ALL_EVENTS: _ClassVar[RecurrenceEditScope]
    RECURRENCE_EDIT_SCOPE_THIS_AND_FOLLOWING: _ClassVar[RecurrenceEditScope]
RECURRENCE_PATTERN_UNSPECIFIED: RecurrencePattern
RECURRENCE_PATTERN_NONE: RecurrencePattern
RECURRENCE_PATTERN_DAILY: RecurrencePattern
RECURRENCE_PATTERN_WEEKLY: RecurrencePattern
RECURRENCE_PATTERN_BIWEEKLY: RecurrencePattern
RECURRENCE_PATTERN_MONTHLY: RecurrencePattern
RECURRENCE_PATTERN_YEARLY: RecurrencePattern
DAY_OF_WEEK_UNSPECIFIED: DayOfWeek
DAY_OF_WEEK_MONDAY: DayOfWeek
DAY_OF_WEEK_TUESDAY: DayOfWeek
DAY_OF_WEEK_WEDNESDAY: DayOfWeek
DAY_OF_WEEK_THURSDAY: DayOfWeek
DAY_OF_WEEK_FRIDAY: DayOfWeek
DAY_OF_WEEK_SATURDAY: DayOfWeek
DAY_OF_WEEK_SUNDAY: DayOfWeek
ATTENDEE_STATUS_UNSPECIFIED: AttendeeStatus
ATTENDEE_STATUS_PENDING: AttendeeStatus
ATTENDEE_STATUS_ACCEPTED: AttendeeStatus
ATTENDEE_STATUS_TENTATIVE: AttendeeStatus
ATTENDEE_STATUS_DECLINED: AttendeeStatus
ATTENDEE_ROLE_UNSPECIFIED: AttendeeRole
ATTENDEE_ROLE_ORGANIZER: AttendeeRole
ATTENDEE_ROLE_REQUIRED: AttendeeRole
ATTENDEE_ROLE_OPTIONAL: AttendeeRole
CALENDAR_TYPE_UNSPECIFIED: CalendarType
CALENDAR_TYPE_PERSONAL: CalendarType
CALENDAR_TYPE_WORK: CalendarType
CALENDAR_TYPE_TEAM: CalendarType
CALENDAR_TYPE_SHARED: CalendarType
RESOURCE_TYPE_UNSPECIFIED: ResourceType
RESOURCE_TYPE_NOTE: ResourceType
RESOURCE_TYPE_FILE: ResourceType
RESOURCE_TYPE_CHAT: ResourceType
RECURRENCE_EDIT_SCOPE_UNSPECIFIED: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_THIS_EVENT: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_ALL_EVENTS: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_THIS_AND_FOLLOWING: RecurrenceEditScope

class CalendarEvent(_message.Message):
    __slots__ = ("id", "organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "attendees", "organizer_id", "recurrence", "is_focus_time", "linked_resources", "access_mode", "is_deleted", "outgoing_references", "created_at", "updated_at", "deleted_at", "reminders", "is_recurring", "recurrence_id", "occurrence_date", "room_id", "room_name", "room_location", "room_capacity", "room_amenities", "baseline_role", "tags")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_ALL_DAY_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    ATTENDEES_FIELD_NUMBER: _ClassVar[int]
    ORGANIZER_ID_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_FIELD_NUMBER: _ClassVar[int]
    IS_FOCUS_TIME_FIELD_NUMBER: _ClassVar[int]
    LINKED_RESOURCES_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    IS_DELETED_FIELD_NUMBER: _ClassVar[int]
    OUTGOING_REFERENCES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    REMINDERS_FIELD_NUMBER: _ClassVar[int]
    IS_RECURRING_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_ID_FIELD_NUMBER: _ClassVar[int]
    OCCURRENCE_DATE_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_NAME_FIELD_NUMBER: _ClassVar[int]
    ROOM_LOCATION_FIELD_NUMBER: _ClassVar[int]
    ROOM_CAPACITY_FIELD_NUMBER: _ClassVar[int]
    ROOM_AMENITIES_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    title: str
    description: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_all_day: bool
    timezone: str
    location: str
    meeting_url: str
    calendar_id: str
    category_id: str
    attendees: _containers.RepeatedCompositeFieldContainer[Attendee]
    organizer_id: str
    recurrence: RecurrenceConfig
    is_focus_time: bool
    linked_resources: _containers.RepeatedCompositeFieldContainer[LinkedResource]
    access_mode: _common_pb2.AccessMode
    is_deleted: bool
    outgoing_references: _containers.RepeatedScalarFieldContainer[str]
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    reminders: _containers.RepeatedScalarFieldContainer[int]
    is_recurring: bool
    recurrence_id: str
    occurrence_date: str
    room_id: str
    room_name: str
    room_location: str
    room_capacity: int
    room_amenities: _containers.RepeatedScalarFieldContainer[str]
    baseline_role: _common_pb2.ContentRole
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., attendees: _Optional[_Iterable[_Union[Attendee, _Mapping]]] = ..., organizer_id: _Optional[str] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resources: _Optional[_Iterable[_Union[LinkedResource, _Mapping]]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., is_deleted: _Optional[bool] = ..., outgoing_references: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., reminders: _Optional[_Iterable[int]] = ..., is_recurring: _Optional[bool] = ..., recurrence_id: _Optional[str] = ..., occurrence_date: _Optional[str] = ..., room_id: _Optional[str] = ..., room_name: _Optional[str] = ..., room_location: _Optional[str] = ..., room_capacity: _Optional[int] = ..., room_amenities: _Optional[_Iterable[str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ...) -> None: ...

class Attendee(_message.Message):
    __slots__ = ("id", "name", "email", "avatar_url", "initials", "status", "role", "timezone")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    INITIALS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    email: str
    avatar_url: str
    initials: str
    status: AttendeeStatus
    role: AttendeeRole
    timezone: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., initials: _Optional[str] = ..., status: _Optional[_Union[AttendeeStatus, str]] = ..., role: _Optional[_Union[AttendeeRole, str]] = ..., timezone: _Optional[str] = ...) -> None: ...

class RecurrenceConfig(_message.Message):
    __slots__ = ("pattern", "interval", "days_of_week", "day_of_month", "end_date", "max_occurrences")
    PATTERN_FIELD_NUMBER: _ClassVar[int]
    INTERVAL_FIELD_NUMBER: _ClassVar[int]
    DAYS_OF_WEEK_FIELD_NUMBER: _ClassVar[int]
    DAY_OF_MONTH_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    MAX_OCCURRENCES_FIELD_NUMBER: _ClassVar[int]
    pattern: RecurrencePattern
    interval: int
    days_of_week: _containers.RepeatedScalarFieldContainer[DayOfWeek]
    day_of_month: int
    end_date: _timestamp_pb2.Timestamp
    max_occurrences: int
    def __init__(self, pattern: _Optional[_Union[RecurrencePattern, str]] = ..., interval: _Optional[int] = ..., days_of_week: _Optional[_Iterable[_Union[DayOfWeek, str]]] = ..., day_of_month: _Optional[int] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., max_occurrences: _Optional[int] = ...) -> None: ...

class LinkedResource(_message.Message):
    __slots__ = ("id", "type", "name", "url")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: ResourceType
    name: str
    url: str
    def __init__(self, id: _Optional[str] = ..., type: _Optional[_Union[ResourceType, str]] = ..., name: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class CreateEventRequest(_message.Message):
    __slots__ = ("organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "attendee_ids", "recurrence", "is_focus_time", "linked_resource_urns", "access_mode", "reminders", "room_id", "baseline_role", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_ALL_DAY_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    ATTENDEE_IDS_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_FIELD_NUMBER: _ClassVar[int]
    IS_FOCUS_TIME_FIELD_NUMBER: _ClassVar[int]
    LINKED_RESOURCE_URNS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    REMINDERS_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    title: str
    description: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_all_day: bool
    timezone: str
    location: str
    meeting_url: str
    calendar_id: str
    category_id: str
    attendee_ids: _containers.RepeatedScalarFieldContainer[str]
    recurrence: RecurrenceConfig
    is_focus_time: bool
    linked_resource_urns: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    reminders: _containers.RepeatedScalarFieldContainer[int]
    room_id: str
    baseline_role: _common_pb2.ContentRole
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., attendee_ids: _Optional[_Iterable[str]] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resource_urns: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., reminders: _Optional[_Iterable[int]] = ..., room_id: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "recurrence", "is_focus_time", "linked_resource_urns", "access_mode", "attendee_ids", "reminders", "recurrence_edit_scope", "occurrence_date", "room_id", "baseline_role", "tag_ids")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_ALL_DAY_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_FIELD_NUMBER: _ClassVar[int]
    IS_FOCUS_TIME_FIELD_NUMBER: _ClassVar[int]
    LINKED_RESOURCE_URNS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    ATTENDEE_IDS_FIELD_NUMBER: _ClassVar[int]
    REMINDERS_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_EDIT_SCOPE_FIELD_NUMBER: _ClassVar[int]
    OCCURRENCE_DATE_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    title: str
    description: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_all_day: bool
    timezone: str
    location: str
    meeting_url: str
    calendar_id: str
    category_id: str
    recurrence: RecurrenceConfig
    is_focus_time: bool
    linked_resource_urns: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    attendee_ids: _containers.RepeatedScalarFieldContainer[str]
    reminders: _containers.RepeatedScalarFieldContainer[int]
    recurrence_edit_scope: RecurrenceEditScope
    occurrence_date: str
    room_id: str
    baseline_role: _common_pb2.ContentRole
    tag_ids: EventTagIds
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resource_urns: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., attendee_ids: _Optional[_Iterable[str]] = ..., reminders: _Optional[_Iterable[int]] = ..., recurrence_edit_scope: _Optional[_Union[RecurrenceEditScope, str]] = ..., occurrence_date: _Optional[str] = ..., room_id: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tag_ids: _Optional[_Union[EventTagIds, _Mapping]] = ...) -> None: ...

class EventTagIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class DeleteEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "permanent", "recurrence_edit_scope", "occurrence_date")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_EDIT_SCOPE_FIELD_NUMBER: _ClassVar[int]
    OCCURRENCE_DATE_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    permanent: bool
    recurrence_edit_scope: RecurrenceEditScope
    occurrence_date: str
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., permanent: _Optional[bool] = ..., recurrence_edit_scope: _Optional[_Union[RecurrenceEditScope, str]] = ..., occurrence_date: _Optional[str] = ...) -> None: ...

class DeleteEventResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class EventResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class ListEventsRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id", "category_id", "start_date", "end_date", "include_deleted", "page", "page_size", "sort_by", "sort_order", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    category_id: str
    start_date: _timestamp_pb2.Timestamp
    end_date: _timestamp_pb2.Timestamp
    include_deleted: bool
    page: int
    page_size: int
    sort_by: str
    sort_order: str
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., include_deleted: _Optional[bool] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListEventsResponse(_message.Message):
    __slots__ = ("events", "total_count", "page", "page_size", "total_pages")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[CalendarEvent]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    def __init__(self, events: _Optional[_Iterable[_Union[CalendarEvent, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class GetEventsInRangeRequest(_message.Message):
    __slots__ = ("organization_id", "start_date", "end_date", "calendar_ids", "category_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_IDS_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    start_date: _timestamp_pb2.Timestamp
    end_date: _timestamp_pb2.Timestamp
    calendar_ids: _containers.RepeatedScalarFieldContainer[str]
    category_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., calendar_ids: _Optional[_Iterable[str]] = ..., category_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetEventsInRangeResponse(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[CalendarEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[CalendarEvent, _Mapping]]] = ...) -> None: ...

class Calendar(_message.Message):
    __slots__ = ("id", "organization_id", "name", "color", "is_visible", "is_default", "owner_id", "type", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    IS_VISIBLE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    color: str
    is_visible: bool
    is_default: bool
    owner_id: str
    type: CalendarType
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., is_visible: _Optional[bool] = ..., is_default: _Optional[bool] = ..., owner_id: _Optional[str] = ..., type: _Optional[_Union[CalendarType, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateCalendarRequest(_message.Message):
    __slots__ = ("organization_id", "name", "color", "type", "is_default")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    color: str
    type: CalendarType
    is_default: bool
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., type: _Optional[_Union[CalendarType, str]] = ..., is_default: _Optional[bool] = ...) -> None: ...

class GetCalendarRequest(_message.Message):
    __slots__ = ("calendar_id", "organization_id")
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    calendar_id: str
    organization_id: str
    def __init__(self, calendar_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateCalendarRequest(_message.Message):
    __slots__ = ("calendar_id", "organization_id", "name", "color", "is_visible", "is_default", "type")
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    IS_VISIBLE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    calendar_id: str
    organization_id: str
    name: str
    color: str
    is_visible: bool
    is_default: bool
    type: CalendarType
    def __init__(self, calendar_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., is_visible: _Optional[bool] = ..., is_default: _Optional[bool] = ..., type: _Optional[_Union[CalendarType, str]] = ...) -> None: ...

class DeleteCalendarRequest(_message.Message):
    __slots__ = ("calendar_id", "organization_id")
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    calendar_id: str
    organization_id: str
    def __init__(self, calendar_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteCalendarResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class CalendarResponse(_message.Message):
    __slots__ = ("calendar",)
    CALENDAR_FIELD_NUMBER: _ClassVar[int]
    calendar: Calendar
    def __init__(self, calendar: _Optional[_Union[Calendar, _Mapping]] = ...) -> None: ...

class ListCalendarsRequest(_message.Message):
    __slots__ = ("organization_id", "visible_only")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    VISIBLE_ONLY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    visible_only: bool
    def __init__(self, organization_id: _Optional[str] = ..., visible_only: _Optional[bool] = ...) -> None: ...

class ListCalendarsResponse(_message.Message):
    __slots__ = ("calendars",)
    CALENDARS_FIELD_NUMBER: _ClassVar[int]
    calendars: _containers.RepeatedCompositeFieldContainer[Calendar]
    def __init__(self, calendars: _Optional[_Iterable[_Union[Calendar, _Mapping]]] = ...) -> None: ...

class Category(_message.Message):
    __slots__ = ("id", "organization_id", "name", "color", "icon", "is_default", "sort_order", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    color: str
    icon: str
    is_default: bool
    sort_order: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., icon: _Optional[str] = ..., is_default: _Optional[bool] = ..., sort_order: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateCategoryRequest(_message.Message):
    __slots__ = ("organization_id", "name", "color", "icon")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    color: str
    icon: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., icon: _Optional[str] = ...) -> None: ...

class GetCategoryRequest(_message.Message):
    __slots__ = ("category_id", "organization_id")
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    category_id: str
    organization_id: str
    def __init__(self, category_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateCategoryRequest(_message.Message):
    __slots__ = ("category_id", "organization_id", "name", "color", "icon", "sort_order")
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    category_id: str
    organization_id: str
    name: str
    color: str
    icon: str
    sort_order: int
    def __init__(self, category_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., icon: _Optional[str] = ..., sort_order: _Optional[int] = ...) -> None: ...

class DeleteCategoryRequest(_message.Message):
    __slots__ = ("category_id", "organization_id")
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    category_id: str
    organization_id: str
    def __init__(self, category_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteCategoryResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class CategoryResponse(_message.Message):
    __slots__ = ("category",)
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    category: Category
    def __init__(self, category: _Optional[_Union[Category, _Mapping]] = ...) -> None: ...

class ListCategoriesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListCategoriesResponse(_message.Message):
    __slots__ = ("categories",)
    CATEGORIES_FIELD_NUMBER: _ClassVar[int]
    categories: _containers.RepeatedCompositeFieldContainer[Category]
    def __init__(self, categories: _Optional[_Iterable[_Union[Category, _Mapping]]] = ...) -> None: ...

class UpdateAttendeeStatusRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "status")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    status: AttendeeStatus
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., status: _Optional[_Union[AttendeeStatus, str]] = ...) -> None: ...

class UpdateAttendeeStatusResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class AddAttendeesRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "user_ids", "role")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    role: AttendeeRole
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ..., role: _Optional[_Union[AttendeeRole, str]] = ...) -> None: ...

class RemoveAttendeesRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "user_ids")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class EventTemplate(_message.Message):
    __slots__ = ("id", "organization_id", "title", "description", "duration_minutes", "location", "meeting_url", "category_id", "tags", "access_mode", "created_by", "created_at", "updated_at", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    title: str
    description: str
    duration_minutes: int
    location: str
    meeting_url: str
    category_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., duration_minutes: _Optional[int] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., category_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreateEventTemplateRequest(_message.Message):
    __slots__ = ("organization_id", "title", "description", "duration_minutes", "location", "meeting_url", "category_id", "tags", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    title: str
    description: str
    duration_minutes: int
    location: str
    meeting_url: str
    category_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., duration_minutes: _Optional[int] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., category_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class GetEventTemplateRequest(_message.Message):
    __slots__ = ("template_id", "organization_id")
    TEMPLATE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    template_id: str
    organization_id: str
    def __init__(self, template_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateEventTemplateRequest(_message.Message):
    __slots__ = ("template_id", "organization_id", "title", "description", "duration_minutes", "location", "meeting_url", "category_id", "tags", "access_mode", "baseline_role")
    TEMPLATE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    template_id: str
    organization_id: str
    title: str
    description: str
    duration_minutes: int
    location: str
    meeting_url: str
    category_id: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, template_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., duration_minutes: _Optional[int] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., category_id: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class DeleteEventTemplateRequest(_message.Message):
    __slots__ = ("template_id", "organization_id")
    TEMPLATE_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    template_id: str
    organization_id: str
    def __init__(self, template_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteEventTemplateResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class EventTemplateResponse(_message.Message):
    __slots__ = ("template",)
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    template: EventTemplate
    def __init__(self, template: _Optional[_Union[EventTemplate, _Mapping]] = ...) -> None: ...

class ListEventTemplatesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListEventTemplatesResponse(_message.Message):
    __slots__ = ("templates",)
    TEMPLATES_FIELD_NUMBER: _ClassVar[int]
    templates: _containers.RepeatedCompositeFieldContainer[EventTemplate]
    def __init__(self, templates: _Optional[_Iterable[_Union[EventTemplate, _Mapping]]] = ...) -> None: ...
