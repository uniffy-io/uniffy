from support.v1 import support_consent_pb2 as _support_consent_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RequestSessionRequest(_message.Message):
    __slots__ = ("organization_id", "reason", "scope", "duration_minutes")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    DURATION_MINUTES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    scope: _support_consent_pb2.SupportSessionScope
    duration_minutes: int
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ..., scope: _Optional[_Union[_support_consent_pb2.SupportSessionScope, str]] = ..., duration_minutes: _Optional[int] = ...) -> None: ...

class RequestSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: _support_consent_pb2.SupportSession
    def __init__(self, session: _Optional[_Union[_support_consent_pb2.SupportSession, _Mapping]] = ...) -> None: ...

class ListMySessionsRequest(_message.Message):
    __slots__ = ("page", "page_size", "include_inactive")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    include_inactive: bool
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListMySessionsResponse(_message.Message):
    __slots__ = ("sessions", "total_count", "page", "page_size")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[_support_consent_pb2.SupportSession]
    total_count: int
    page: int
    page_size: int
    def __init__(self, sessions: _Optional[_Iterable[_Union[_support_consent_pb2.SupportSession, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListAllSessionsRequest(_message.Message):
    __slots__ = ("page", "page_size", "state", "search")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    state: _support_consent_pb2.SupportSessionState
    search: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., state: _Optional[_Union[_support_consent_pb2.SupportSessionState, str]] = ..., search: _Optional[str] = ...) -> None: ...

class ListAllSessionsResponse(_message.Message):
    __slots__ = ("sessions", "total_count", "page", "page_size")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[_support_consent_pb2.SupportSession]
    total_count: int
    page: int
    page_size: int
    def __init__(self, sessions: _Optional[_Iterable[_Union[_support_consent_pb2.SupportSession, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...
