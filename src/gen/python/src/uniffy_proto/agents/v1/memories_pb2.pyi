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

class MemoryCategory(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MEMORY_CATEGORY_UNSPECIFIED: _ClassVar[MemoryCategory]
    MEMORY_CATEGORY_PREFERENCES: _ClassVar[MemoryCategory]
    MEMORY_CATEGORY_FACTS: _ClassVar[MemoryCategory]
    MEMORY_CATEGORY_CONTEXT: _ClassVar[MemoryCategory]
    MEMORY_CATEGORY_INSTRUCTIONS: _ClassVar[MemoryCategory]
MEMORY_CATEGORY_UNSPECIFIED: MemoryCategory
MEMORY_CATEGORY_PREFERENCES: MemoryCategory
MEMORY_CATEGORY_FACTS: MemoryCategory
MEMORY_CATEGORY_CONTEXT: MemoryCategory
MEMORY_CATEGORY_INSTRUCTIONS: MemoryCategory

class MemoryInfo(_message.Message):
    __slots__ = ("id", "agent_id", "key", "content", "category", "importance", "access_count", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    ACCESS_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    agent_id: str
    key: str
    content: str
    category: MemoryCategory
    importance: float
    access_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., agent_id: _Optional[str] = ..., key: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ..., access_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListMemoriesRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "category", "search", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    category: MemoryCategory
    search: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., search: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListMemoriesResponse(_message.Message):
    __slots__ = ("memories", "pagination")
    MEMORIES_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    memories: _containers.RepeatedCompositeFieldContainer[MemoryInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, memories: _Optional[_Iterable[_Union[MemoryInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class CreateMemoryRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "key", "content", "category", "importance")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    key: str
    content: str
    category: MemoryCategory
    importance: float
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., key: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ...) -> None: ...

class UpdateMemoryRequest(_message.Message):
    __slots__ = ("organization_id", "memory_id", "content", "category", "importance")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    memory_id: str
    content: str
    category: MemoryCategory
    importance: float
    def __init__(self, organization_id: _Optional[str] = ..., memory_id: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ...) -> None: ...

class CreateMemoryResponse(_message.Message):
    __slots__ = ("memory",)
    MEMORY_FIELD_NUMBER: _ClassVar[int]
    memory: MemoryInfo
    def __init__(self, memory: _Optional[_Union[MemoryInfo, _Mapping]] = ...) -> None: ...

class UpdateMemoryResponse(_message.Message):
    __slots__ = ("memory",)
    MEMORY_FIELD_NUMBER: _ClassVar[int]
    memory: MemoryInfo
    def __init__(self, memory: _Optional[_Union[MemoryInfo, _Mapping]] = ...) -> None: ...

class DeleteMemoryRequest(_message.Message):
    __slots__ = ("organization_id", "memory_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    memory_id: str
    def __init__(self, organization_id: _Optional[str] = ..., memory_id: _Optional[str] = ...) -> None: ...

class DeleteMemoryResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
