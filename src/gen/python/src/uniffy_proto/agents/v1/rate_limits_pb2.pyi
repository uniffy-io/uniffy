import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RateLimit(_message.Message):
    __slots__ = ("kind", "limit", "window_seconds", "is_override", "created_at", "updated_at")
    KIND_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    WINDOW_SECONDS_FIELD_NUMBER: _ClassVar[int]
    IS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    kind: _common_pb2.RateLimitKind
    limit: int
    window_seconds: int
    is_override: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, kind: _Optional[_Union[_common_pb2.RateLimitKind, str]] = ..., limit: _Optional[int] = ..., window_seconds: _Optional[int] = ..., is_override: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetRateLimitsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetRateLimitsResponse(_message.Message):
    __slots__ = ("limits",)
    LIMITS_FIELD_NUMBER: _ClassVar[int]
    limits: _containers.RepeatedCompositeFieldContainer[RateLimit]
    def __init__(self, limits: _Optional[_Iterable[_Union[RateLimit, _Mapping]]] = ...) -> None: ...

class UpsertRateLimitRequest(_message.Message):
    __slots__ = ("organization_id", "kind", "limit", "window_seconds")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    WINDOW_SECONDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    kind: _common_pb2.RateLimitKind
    limit: int
    window_seconds: int
    def __init__(self, organization_id: _Optional[str] = ..., kind: _Optional[_Union[_common_pb2.RateLimitKind, str]] = ..., limit: _Optional[int] = ..., window_seconds: _Optional[int] = ...) -> None: ...

class RateLimitResponse(_message.Message):
    __slots__ = ("limit",)
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    limit: RateLimit
    def __init__(self, limit: _Optional[_Union[RateLimit, _Mapping]] = ...) -> None: ...

class DeleteRateLimitRequest(_message.Message):
    __slots__ = ("organization_id", "kind")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    kind: _common_pb2.RateLimitKind
    def __init__(self, organization_id: _Optional[str] = ..., kind: _Optional[_Union[_common_pb2.RateLimitKind, str]] = ...) -> None: ...

class DeleteRateLimitResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
