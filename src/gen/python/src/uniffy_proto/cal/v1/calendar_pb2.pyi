import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
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

class EventActivityAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVENT_ACTIVITY_ACTION_UNSPECIFIED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_CREATED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_TITLE_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_SCHEDULE_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_LOCATION_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_MEETING_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_DESCRIPTION_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_CATEGORY_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_CALENDAR_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_RECURRENCE_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_REMINDERS_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_ATTENDEES_ADDED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_ATTENDEES_REMOVED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_RESPONSE_CHANGED: _ClassVar[EventActivityAction]
    EVENT_ACTIVITY_ACTION_FIELD_UPDATED: _ClassVar[EventActivityAction]

class AttendeeRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ATTENDEE_ROLE_UNSPECIFIED: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_ORGANIZER: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_REQUIRED: _ClassVar[AttendeeRole]
    ATTENDEE_ROLE_OPTIONAL: _ClassVar[AttendeeRole]

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

class EventStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVENT_STATUS_UNSPECIFIED: _ClassVar[EventStatus]
    EVENT_STATUS_CONFIRMED: _ClassVar[EventStatus]
    EVENT_STATUS_TENTATIVE: _ClassVar[EventStatus]
    EVENT_STATUS_CANCELLED: _ClassVar[EventStatus]

class EventVisibility(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVENT_VISIBILITY_UNSPECIFIED: _ClassVar[EventVisibility]
    EVENT_VISIBILITY_STANDARD: _ClassVar[EventVisibility]
    EVENT_VISIBILITY_PRIVATE: _ClassVar[EventVisibility]

class EventTransparency(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVENT_TRANSPARENCY_UNSPECIFIED: _ClassVar[EventTransparency]
    EVENT_TRANSPARENCY_OPAQUE: _ClassVar[EventTransparency]
    EVENT_TRANSPARENCY_TRANSPARENT: _ClassVar[EventTransparency]
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
EVENT_ACTIVITY_ACTION_UNSPECIFIED: EventActivityAction
EVENT_ACTIVITY_ACTION_CREATED: EventActivityAction
EVENT_ACTIVITY_ACTION_TITLE_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_SCHEDULE_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_LOCATION_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_MEETING_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_DESCRIPTION_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_CATEGORY_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_CALENDAR_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_RECURRENCE_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_REMINDERS_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_ATTENDEES_ADDED: EventActivityAction
EVENT_ACTIVITY_ACTION_ATTENDEES_REMOVED: EventActivityAction
EVENT_ACTIVITY_ACTION_RESPONSE_CHANGED: EventActivityAction
EVENT_ACTIVITY_ACTION_FIELD_UPDATED: EventActivityAction
ATTENDEE_ROLE_UNSPECIFIED: AttendeeRole
ATTENDEE_ROLE_ORGANIZER: AttendeeRole
ATTENDEE_ROLE_REQUIRED: AttendeeRole
ATTENDEE_ROLE_OPTIONAL: AttendeeRole
RESOURCE_TYPE_UNSPECIFIED: ResourceType
RESOURCE_TYPE_NOTE: ResourceType
RESOURCE_TYPE_FILE: ResourceType
RESOURCE_TYPE_CHAT: ResourceType
RECURRENCE_EDIT_SCOPE_UNSPECIFIED: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_THIS_EVENT: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_ALL_EVENTS: RecurrenceEditScope
RECURRENCE_EDIT_SCOPE_THIS_AND_FOLLOWING: RecurrenceEditScope
EVENT_STATUS_UNSPECIFIED: EventStatus
EVENT_STATUS_CONFIRMED: EventStatus
EVENT_STATUS_TENTATIVE: EventStatus
EVENT_STATUS_CANCELLED: EventStatus
EVENT_VISIBILITY_UNSPECIFIED: EventVisibility
EVENT_VISIBILITY_STANDARD: EventVisibility
EVENT_VISIBILITY_PRIVATE: EventVisibility
EVENT_TRANSPARENCY_UNSPECIFIED: EventTransparency
EVENT_TRANSPARENCY_OPAQUE: EventTransparency
EVENT_TRANSPARENCY_TRANSPARENT: EventTransparency

class CalendarEvent(_message.Message):
    __slots__ = ("id", "organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "attendees", "organizer_id", "recurrence", "is_focus_time", "linked_resources", "is_deleted", "outgoing_references", "created_at", "updated_at", "deleted_at", "reminders", "is_recurring", "recurrence_id", "occurrence_date", "room_id", "room_name", "room_location", "room_capacity", "room_amenities", "tags", "channel_id", "channel_auto_created", "user_role", "status", "visibility", "transparency", "is_out_of_office", "details_hidden")
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
    TAGS_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_AUTO_CREATED_FIELD_NUMBER: _ClassVar[int]
    USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TRANSPARENCY_FIELD_NUMBER: _ClassVar[int]
    IS_OUT_OF_OFFICE_FIELD_NUMBER: _ClassVar[int]
    DETAILS_HIDDEN_FIELD_NUMBER: _ClassVar[int]
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
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    channel_id: str
    channel_auto_created: bool
    user_role: _common_pb2.ContentRole
    status: EventStatus
    visibility: EventVisibility
    transparency: EventTransparency
    is_out_of_office: bool
    details_hidden: bool
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., attendees: _Optional[_Iterable[_Union[Attendee, _Mapping]]] = ..., organizer_id: _Optional[str] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resources: _Optional[_Iterable[_Union[LinkedResource, _Mapping]]] = ..., is_deleted: _Optional[bool] = ..., outgoing_references: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., reminders: _Optional[_Iterable[int]] = ..., is_recurring: _Optional[bool] = ..., recurrence_id: _Optional[str] = ..., occurrence_date: _Optional[str] = ..., room_id: _Optional[str] = ..., room_name: _Optional[str] = ..., room_location: _Optional[str] = ..., room_capacity: _Optional[int] = ..., room_amenities: _Optional[_Iterable[str]] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ..., channel_id: _Optional[str] = ..., channel_auto_created: _Optional[bool] = ..., user_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., status: _Optional[_Union[EventStatus, str]] = ..., visibility: _Optional[_Union[EventVisibility, str]] = ..., transparency: _Optional[_Union[EventTransparency, str]] = ..., is_out_of_office: _Optional[bool] = ..., details_hidden: _Optional[bool] = ...) -> None: ...

class Attendee(_message.Message):
    __slots__ = ("id", "name", "email", "avatar_url", "initials", "status", "role", "timezone", "invited_via_group_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    INITIALS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    INVITED_VIA_GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    email: str
    avatar_url: str
    initials: str
    status: AttendeeStatus
    role: AttendeeRole
    timezone: str
    invited_via_group_id: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., initials: _Optional[str] = ..., status: _Optional[_Union[AttendeeStatus, str]] = ..., role: _Optional[_Union[AttendeeRole, str]] = ..., timezone: _Optional[str] = ..., invited_via_group_id: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "attendee_ids", "recurrence", "is_focus_time", "linked_resource_urns", "reminders", "room_id", "tag_ids", "channel_id", "channel_auto_created", "status", "visibility", "transparency", "is_out_of_office", "attendees", "no_reminders")
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
    REMINDERS_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_AUTO_CREATED_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TRANSPARENCY_FIELD_NUMBER: _ClassVar[int]
    IS_OUT_OF_OFFICE_FIELD_NUMBER: _ClassVar[int]
    ATTENDEES_FIELD_NUMBER: _ClassVar[int]
    NO_REMINDERS_FIELD_NUMBER: _ClassVar[int]
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
    reminders: _containers.RepeatedScalarFieldContainer[int]
    room_id: str
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    channel_id: str
    channel_auto_created: bool
    status: EventStatus
    visibility: EventVisibility
    transparency: EventTransparency
    is_out_of_office: bool
    attendees: _containers.RepeatedCompositeFieldContainer[AttendeeInput]
    no_reminders: bool
    def __init__(self, organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., attendee_ids: _Optional[_Iterable[str]] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resource_urns: _Optional[_Iterable[str]] = ..., reminders: _Optional[_Iterable[int]] = ..., room_id: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ..., channel_id: _Optional[str] = ..., channel_auto_created: _Optional[bool] = ..., status: _Optional[_Union[EventStatus, str]] = ..., visibility: _Optional[_Union[EventVisibility, str]] = ..., transparency: _Optional[_Union[EventTransparency, str]] = ..., is_out_of_office: _Optional[bool] = ..., attendees: _Optional[_Iterable[_Union[AttendeeInput, _Mapping]]] = ..., no_reminders: _Optional[bool] = ...) -> None: ...

class AttendeeInput(_message.Message):
    __slots__ = ("user_id", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    role: AttendeeRole
    def __init__(self, user_id: _Optional[str] = ..., role: _Optional[_Union[AttendeeRole, str]] = ...) -> None: ...

class GetEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UpdateEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "title", "description", "start_time", "end_time", "is_all_day", "timezone", "location", "meeting_url", "calendar_id", "category_id", "recurrence", "is_focus_time", "linked_resource_urns", "attendee_ids", "reminders", "recurrence_edit_scope", "occurrence_date", "room_id", "tag_ids", "channel_id", "channel_auto_created", "status", "visibility", "transparency", "is_out_of_office", "clear_reminders")
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
    ATTENDEE_IDS_FIELD_NUMBER: _ClassVar[int]
    REMINDERS_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_EDIT_SCOPE_FIELD_NUMBER: _ClassVar[int]
    OCCURRENCE_DATE_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_AUTO_CREATED_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TRANSPARENCY_FIELD_NUMBER: _ClassVar[int]
    IS_OUT_OF_OFFICE_FIELD_NUMBER: _ClassVar[int]
    CLEAR_REMINDERS_FIELD_NUMBER: _ClassVar[int]
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
    attendee_ids: _containers.RepeatedScalarFieldContainer[str]
    reminders: _containers.RepeatedScalarFieldContainer[int]
    recurrence_edit_scope: RecurrenceEditScope
    occurrence_date: str
    room_id: str
    tag_ids: EventTagIds
    channel_id: str
    channel_auto_created: bool
    status: EventStatus
    visibility: EventVisibility
    transparency: EventTransparency
    is_out_of_office: bool
    clear_reminders: bool
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., timezone: _Optional[str] = ..., location: _Optional[str] = ..., meeting_url: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., recurrence: _Optional[_Union[RecurrenceConfig, _Mapping]] = ..., is_focus_time: _Optional[bool] = ..., linked_resource_urns: _Optional[_Iterable[str]] = ..., attendee_ids: _Optional[_Iterable[str]] = ..., reminders: _Optional[_Iterable[int]] = ..., recurrence_edit_scope: _Optional[_Union[RecurrenceEditScope, str]] = ..., occurrence_date: _Optional[str] = ..., room_id: _Optional[str] = ..., tag_ids: _Optional[_Union[EventTagIds, _Mapping]] = ..., channel_id: _Optional[str] = ..., channel_auto_created: _Optional[bool] = ..., status: _Optional[_Union[EventStatus, str]] = ..., visibility: _Optional[_Union[EventVisibility, str]] = ..., transparency: _Optional[_Union[EventTransparency, str]] = ..., is_out_of_office: _Optional[bool] = ..., clear_reminders: _Optional[bool] = ...) -> None: ...

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

class CreateEventResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class GetEventResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class UpdateEventResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class AddAttendeesResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class UpdateAttendeeRoleRequest(_message.Message):
    __slots__ = ("event_id", "organization_id", "user_id", "role")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    user_id: str
    role: AttendeeRole
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[AttendeeRole, str]] = ...) -> None: ...

class UpdateAttendeeRoleResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class RemoveAttendeesResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: CalendarEvent
    def __init__(self, event: _Optional[_Union[CalendarEvent, _Mapping]] = ...) -> None: ...

class ListEventsRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id", "category_id", "start_date", "end_date", "include_deleted", "page", "page_size", "sort_by", "sort_order", "tag_ids", "page_token")
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
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
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
    page_token: str
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ..., category_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., include_deleted: _Optional[bool] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListEventsResponse(_message.Message):
    __slots__ = ("events", "total_count", "page", "page_size", "total_pages", "next_page_token")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[CalendarEvent]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    next_page_token: str
    def __init__(self, events: _Optional[_Iterable[_Union[CalendarEvent, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_pages: _Optional[int] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class GetEventsInRangeRequest(_message.Message):
    __slots__ = ("organization_id", "start_date", "end_date", "calendar_ids", "category_ids", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_IDS_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_IDS_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    start_date: _timestamp_pb2.Timestamp
    end_date: _timestamp_pb2.Timestamp
    calendar_ids: _containers.RepeatedScalarFieldContainer[str]
    category_ids: _containers.RepeatedScalarFieldContainer[str]
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., calendar_ids: _Optional[_Iterable[str]] = ..., category_ids: _Optional[_Iterable[str]] = ..., channel_id: _Optional[str] = ...) -> None: ...

class GetEventsInRangeResponse(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[CalendarEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[CalendarEvent, _Mapping]]] = ...) -> None: ...

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

class CreateCategoryResponse(_message.Message):
    __slots__ = ("category",)
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    category: Category
    def __init__(self, category: _Optional[_Union[Category, _Mapping]] = ...) -> None: ...

class GetCategoryResponse(_message.Message):
    __slots__ = ("category",)
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    category: Category
    def __init__(self, category: _Optional[_Union[Category, _Mapping]] = ...) -> None: ...

class UpdateCategoryResponse(_message.Message):
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

class EventActivity(_message.Message):
    __slots__ = ("id", "event_id", "actor_id", "action", "timestamp", "field_id", "previous_value", "new_value")
    ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_VALUE_FIELD_NUMBER: _ClassVar[int]
    NEW_VALUE_FIELD_NUMBER: _ClassVar[int]
    id: str
    event_id: str
    actor_id: str
    action: EventActivityAction
    timestamp: _timestamp_pb2.Timestamp
    field_id: str
    previous_value: str
    new_value: str
    def __init__(self, id: _Optional[str] = ..., event_id: _Optional[str] = ..., actor_id: _Optional[str] = ..., action: _Optional[_Union[EventActivityAction, str]] = ..., timestamp: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., field_id: _Optional[str] = ..., previous_value: _Optional[str] = ..., new_value: _Optional[str] = ...) -> None: ...

class ListEventActivitiesRequest(_message.Message):
    __slots__ = ("organization_id", "event_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    event_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., event_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListEventActivitiesResponse(_message.Message):
    __slots__ = ("activities", "pagination")
    ACTIVITIES_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    activities: _containers.RepeatedCompositeFieldContainer[EventActivity]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, activities: _Optional[_Iterable[_Union[EventActivity, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

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

class CreateEventTemplateResponse(_message.Message):
    __slots__ = ("template",)
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    template: EventTemplate
    def __init__(self, template: _Optional[_Union[EventTemplate, _Mapping]] = ...) -> None: ...

class GetEventTemplateResponse(_message.Message):
    __slots__ = ("template",)
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    template: EventTemplate
    def __init__(self, template: _Optional[_Union[EventTemplate, _Mapping]] = ...) -> None: ...

class UpdateEventTemplateResponse(_message.Message):
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

class BusyInterval(_message.Message):
    __slots__ = ("start_time", "end_time", "is_out_of_office")
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_OUT_OF_OFFICE_FIELD_NUMBER: _ClassVar[int]
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_out_of_office: bool
    def __init__(self, start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_out_of_office: _Optional[bool] = ...) -> None: ...

class UserFreeBusy(_message.Message):
    __slots__ = ("user_id", "intervals", "timezone", "workday_start", "workday_end", "workdays")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    INTERVALS_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    WORKDAY_START_FIELD_NUMBER: _ClassVar[int]
    WORKDAY_END_FIELD_NUMBER: _ClassVar[int]
    WORKDAYS_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    intervals: _containers.RepeatedCompositeFieldContainer[BusyInterval]
    timezone: str
    workday_start: str
    workday_end: str
    workdays: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, user_id: _Optional[str] = ..., intervals: _Optional[_Iterable[_Union[BusyInterval, _Mapping]]] = ..., timezone: _Optional[str] = ..., workday_start: _Optional[str] = ..., workday_end: _Optional[str] = ..., workdays: _Optional[_Iterable[str]] = ...) -> None: ...

class GetFreeBusyRequest(_message.Message):
    __slots__ = ("organization_id", "user_ids", "window_start", "window_end", "room_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    WINDOW_START_FIELD_NUMBER: _ClassVar[int]
    WINDOW_END_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    window_start: _timestamp_pb2.Timestamp
    window_end: _timestamp_pb2.Timestamp
    room_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ..., window_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., window_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., room_id: _Optional[str] = ...) -> None: ...

class GetFreeBusyResponse(_message.Message):
    __slots__ = ("users", "room_busy")
    USERS_FIELD_NUMBER: _ClassVar[int]
    ROOM_BUSY_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[UserFreeBusy]
    room_busy: _containers.RepeatedCompositeFieldContainer[BusyInterval]
    def __init__(self, users: _Optional[_Iterable[_Union[UserFreeBusy, _Mapping]]] = ..., room_busy: _Optional[_Iterable[_Union[BusyInterval, _Mapping]]] = ...) -> None: ...

class SuggestMeetingTimesRequest(_message.Message):
    __slots__ = ("organization_id", "required_user_ids", "optional_user_ids", "window_start", "window_end", "duration_minutes", "room_id", "max_results")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    OPTIONAL_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    WINDOW_START_FIELD_NUMBER: _ClassVar[int]
    WINDOW_END_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    MAX_RESULTS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    required_user_ids: _containers.RepeatedScalarFieldContainer[str]
    optional_user_ids: _containers.RepeatedScalarFieldContainer[str]
    window_start: _timestamp_pb2.Timestamp
    window_end: _timestamp_pb2.Timestamp
    duration_minutes: int
    room_id: str
    max_results: int
    def __init__(self, organization_id: _Optional[str] = ..., required_user_ids: _Optional[_Iterable[str]] = ..., optional_user_ids: _Optional[_Iterable[str]] = ..., window_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., window_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., duration_minutes: _Optional[int] = ..., room_id: _Optional[str] = ..., max_results: _Optional[int] = ...) -> None: ...

class MeetingTimeSuggestion(_message.Message):
    __slots__ = ("start_time", "end_time", "unavailable_optional_user_ids")
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    UNAVAILABLE_OPTIONAL_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    unavailable_optional_user_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., unavailable_optional_user_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SuggestMeetingTimesResponse(_message.Message):
    __slots__ = ("suggestions",)
    SUGGESTIONS_FIELD_NUMBER: _ClassVar[int]
    suggestions: _containers.RepeatedCompositeFieldContainer[MeetingTimeSuggestion]
    def __init__(self, suggestions: _Optional[_Iterable[_Union[MeetingTimeSuggestion, _Mapping]]] = ...) -> None: ...

class ExportEventRequest(_message.Message):
    __slots__ = ("event_id", "organization_id")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    organization_id: str
    def __init__(self, event_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class ExportEventResponse(_message.Message):
    __slots__ = ("content", "filename")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    content: bytes
    filename: str
    def __init__(self, content: _Optional[bytes] = ..., filename: _Optional[str] = ...) -> None: ...

class ExportCalendarRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id", "start_time", "end_time")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ExportCalendarResponse(_message.Message):
    __slots__ = ("content", "filename", "event_count")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    EVENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    content: bytes
    filename: str
    event_count: int
    def __init__(self, content: _Optional[bytes] = ..., filename: _Optional[str] = ..., event_count: _Optional[int] = ...) -> None: ...

class ImportedEventPreview(_message.Message):
    __slots__ = ("title", "start_time", "end_time", "is_all_day", "repeats")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    IS_ALL_DAY_FIELD_NUMBER: _ClassVar[int]
    REPEATS_FIELD_NUMBER: _ClassVar[int]
    title: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    is_all_day: bool
    repeats: bool
    def __init__(self, title: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_all_day: _Optional[bool] = ..., repeats: _Optional[bool] = ...) -> None: ...

class SkippedImportEntry(_message.Message):
    __slots__ = ("label", "reason")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    label: str
    reason: str
    def __init__(self, label: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class PreviewCalendarImportRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id", "content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    content: bytes
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ..., content: _Optional[bytes] = ...) -> None: ...

class PreviewCalendarImportResponse(_message.Message):
    __slots__ = ("creatable", "duplicate_count", "skipped")
    CREATABLE_FIELD_NUMBER: _ClassVar[int]
    DUPLICATE_COUNT_FIELD_NUMBER: _ClassVar[int]
    SKIPPED_FIELD_NUMBER: _ClassVar[int]
    creatable: _containers.RepeatedCompositeFieldContainer[ImportedEventPreview]
    duplicate_count: int
    skipped: _containers.RepeatedCompositeFieldContainer[SkippedImportEntry]
    def __init__(self, creatable: _Optional[_Iterable[_Union[ImportedEventPreview, _Mapping]]] = ..., duplicate_count: _Optional[int] = ..., skipped: _Optional[_Iterable[_Union[SkippedImportEntry, _Mapping]]] = ...) -> None: ...

class ApplyCalendarImportRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id", "content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    content: bytes
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ..., content: _Optional[bytes] = ...) -> None: ...

class ApplyCalendarImportResponse(_message.Message):
    __slots__ = ("created_count", "duplicate_count", "skipped")
    CREATED_COUNT_FIELD_NUMBER: _ClassVar[int]
    DUPLICATE_COUNT_FIELD_NUMBER: _ClassVar[int]
    SKIPPED_FIELD_NUMBER: _ClassVar[int]
    created_count: int
    duplicate_count: int
    skipped: _containers.RepeatedCompositeFieldContainer[SkippedImportEntry]
    def __init__(self, created_count: _Optional[int] = ..., duplicate_count: _Optional[int] = ..., skipped: _Optional[_Iterable[_Union[SkippedImportEntry, _Mapping]]] = ...) -> None: ...

class GetCalendarFeedUrlRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ...) -> None: ...

class GetCalendarFeedUrlResponse(_message.Message):
    __slots__ = ("url", "created_at", "last_used_at")
    URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    url: str
    created_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    def __init__(self, url: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RegenerateCalendarFeedRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ...) -> None: ...

class RegenerateCalendarFeedResponse(_message.Message):
    __slots__ = ("url", "created_at")
    URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    url: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, url: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RevokeCalendarFeedRequest(_message.Message):
    __slots__ = ("organization_id", "calendar_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CALENDAR_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    calendar_id: str
    def __init__(self, organization_id: _Optional[str] = ..., calendar_id: _Optional[str] = ...) -> None: ...

class RevokeCalendarFeedResponse(_message.Message):
    __slots__ = ("revoked",)
    REVOKED_FIELD_NUMBER: _ClassVar[int]
    revoked: bool
    def __init__(self, revoked: _Optional[bool] = ...) -> None: ...
