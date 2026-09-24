import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExportFormat(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXPORT_FORMAT_UNSPECIFIED: _ClassVar[ExportFormat]
    EXPORT_FORMAT_CSV: _ClassVar[ExportFormat]
    EXPORT_FORMAT_JSON: _ClassVar[ExportFormat]

class SortOrder(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SORT_ORDER_UNSPECIFIED: _ClassVar[SortOrder]
    SORT_ORDER_TIME_DESC: _ClassVar[SortOrder]
    SORT_ORDER_TIME_ASC: _ClassVar[SortOrder]
EXPORT_FORMAT_UNSPECIFIED: ExportFormat
EXPORT_FORMAT_CSV: ExportFormat
EXPORT_FORMAT_JSON: ExportFormat
SORT_ORDER_UNSPECIFIED: SortOrder
SORT_ORDER_TIME_DESC: SortOrder
SORT_ORDER_TIME_ASC: SortOrder

class ExportEventsRequest(_message.Message):
    __slots__ = ("filter", "format")
    FILTER_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    filter: ListEventsRequest
    format: ExportFormat
    def __init__(self, filter: _Optional[_Union[ListEventsRequest, _Mapping]] = ..., format: _Optional[_Union[ExportFormat, str]] = ...) -> None: ...

class ExportEventsResponse(_message.Message):
    __slots__ = ("payload",)
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    payload: bytes
    def __init__(self, payload: _Optional[bytes] = ...) -> None: ...

class AuditEvent(_message.Message):
    __slots__ = ("id", "organization_id", "actor_user_id", "actor_org_role", "on_behalf_of_user_id", "action", "resource_type", "resource_id", "details_json", "ip_address", "user_agent", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ORG_ROLE_FIELD_NUMBER: _ClassVar[int]
    ON_BEHALF_OF_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TYPE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    DETAILS_JSON_FIELD_NUMBER: _ClassVar[int]
    IP_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    USER_AGENT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    actor_user_id: str
    actor_org_role: str
    on_behalf_of_user_id: str
    action: str
    resource_type: str
    resource_id: str
    details_json: str
    ip_address: str
    user_agent: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., actor_org_role: _Optional[str] = ..., on_behalf_of_user_id: _Optional[str] = ..., action: _Optional[str] = ..., resource_type: _Optional[str] = ..., resource_id: _Optional[str] = ..., details_json: _Optional[str] = ..., ip_address: _Optional[str] = ..., user_agent: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListEventsRequest(_message.Message):
    __slots__ = ("organization_id", "actor_user_id", "actions", "resource_type", "resource_id", "from_time", "to_time", "page_size", "page_token", "order")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTIONS_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TYPE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_TIME_FIELD_NUMBER: _ClassVar[int]
    TO_TIME_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    actor_user_id: str
    actions: _containers.RepeatedScalarFieldContainer[str]
    resource_type: str
    resource_id: str
    from_time: _timestamp_pb2.Timestamp
    to_time: _timestamp_pb2.Timestamp
    page_size: int
    page_token: str
    order: SortOrder
    def __init__(self, organization_id: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., actions: _Optional[_Iterable[str]] = ..., resource_type: _Optional[str] = ..., resource_id: _Optional[str] = ..., from_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., to_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., order: _Optional[_Union[SortOrder, str]] = ...) -> None: ...

class ListEventsResponse(_message.Message):
    __slots__ = ("events", "next_page_token")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[AuditEvent]
    next_page_token: str
    def __init__(self, events: _Optional[_Iterable[_Union[AuditEvent, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...
