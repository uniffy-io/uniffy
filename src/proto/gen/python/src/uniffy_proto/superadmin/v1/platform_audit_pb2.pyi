import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlatformAuditEvent(_message.Message):
    __slots__ = ("id", "created_at", "action", "organization_id", "organization_name", "actor_user_id", "actor_email", "actor_org_role", "resource_type", "resource_id", "details_json", "ip_address", "user_agent")
    ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_EMAIL_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ORG_ROLE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TYPE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    DETAILS_JSON_FIELD_NUMBER: _ClassVar[int]
    IP_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    USER_AGENT_FIELD_NUMBER: _ClassVar[int]
    id: str
    created_at: _timestamp_pb2.Timestamp
    action: str
    organization_id: str
    organization_name: str
    actor_user_id: str
    actor_email: str
    actor_org_role: str
    resource_type: str
    resource_id: str
    details_json: str
    ip_address: str
    user_agent: str
    def __init__(self, id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., action: _Optional[str] = ..., organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., actor_email: _Optional[str] = ..., actor_org_role: _Optional[str] = ..., resource_type: _Optional[str] = ..., resource_id: _Optional[str] = ..., details_json: _Optional[str] = ..., ip_address: _Optional[str] = ..., user_agent: _Optional[str] = ...) -> None: ...

class ListPlatformAuditRequest(_message.Message):
    __slots__ = ("page", "page_size", "organization_id", "actor_user_id", "actions", "from_ts", "to_ts")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    ACTIONS_FIELD_NUMBER: _ClassVar[int]
    FROM_TS_FIELD_NUMBER: _ClassVar[int]
    TO_TS_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    organization_id: str
    actor_user_id: str
    actions: _containers.RepeatedScalarFieldContainer[str]
    from_ts: _timestamp_pb2.Timestamp
    to_ts: _timestamp_pb2.Timestamp
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., organization_id: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., actions: _Optional[_Iterable[str]] = ..., from_ts: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., to_ts: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListPlatformAuditResponse(_message.Message):
    __slots__ = ("events", "total_count", "page", "page_size")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[PlatformAuditEvent]
    total_count: int
    page: int
    page_size: int
    def __init__(self, events: _Optional[_Iterable[_Union[PlatformAuditEvent, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListPlatformActionsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class PlatformActionEntry(_message.Message):
    __slots__ = ("action", "group")
    ACTION_FIELD_NUMBER: _ClassVar[int]
    GROUP_FIELD_NUMBER: _ClassVar[int]
    action: str
    group: str
    def __init__(self, action: _Optional[str] = ..., group: _Optional[str] = ...) -> None: ...

class ListPlatformActionsResponse(_message.Message):
    __slots__ = ("actions",)
    ACTIONS_FIELD_NUMBER: _ClassVar[int]
    actions: _containers.RepeatedCompositeFieldContainer[PlatformActionEntry]
    def __init__(self, actions: _Optional[_Iterable[_Union[PlatformActionEntry, _Mapping]]] = ...) -> None: ...
