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

class MemoryScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MEMORY_SCOPE_UNSPECIFIED: _ClassVar[MemoryScope]
    MEMORY_SCOPE_USER: _ClassVar[MemoryScope]
    MEMORY_SCOPE_CHANNEL: _ClassVar[MemoryScope]
    MEMORY_SCOPE_SESSION: _ClassVar[MemoryScope]
    MEMORY_SCOPE_ORG: _ClassVar[MemoryScope]

class MemorySource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MEMORY_SOURCE_UNSPECIFIED: _ClassVar[MemorySource]
    MEMORY_SOURCE_TOOL: _ClassVar[MemorySource]
    MEMORY_SOURCE_MANUAL: _ClassVar[MemorySource]
MEMORY_CATEGORY_UNSPECIFIED: MemoryCategory
MEMORY_CATEGORY_PREFERENCES: MemoryCategory
MEMORY_CATEGORY_FACTS: MemoryCategory
MEMORY_CATEGORY_CONTEXT: MemoryCategory
MEMORY_CATEGORY_INSTRUCTIONS: MemoryCategory
MEMORY_SCOPE_UNSPECIFIED: MemoryScope
MEMORY_SCOPE_USER: MemoryScope
MEMORY_SCOPE_CHANNEL: MemoryScope
MEMORY_SCOPE_SESSION: MemoryScope
MEMORY_SCOPE_ORG: MemoryScope
MEMORY_SOURCE_UNSPECIFIED: MemorySource
MEMORY_SOURCE_TOOL: MemorySource
MEMORY_SOURCE_MANUAL: MemorySource

class MemoryInfo(_message.Message):
    __slots__ = ("id", "agent_id", "key", "content", "category", "importance", "access_count", "created_at", "updated_at", "scope", "description", "pinned", "source", "created_by_user_id", "created_by_name", "channel_id", "session_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    ACCESS_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PINNED_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_NAME_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    agent_id: str
    key: str
    content: str
    category: MemoryCategory
    importance: float
    access_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    scope: MemoryScope
    description: str
    pinned: bool
    source: MemorySource
    created_by_user_id: str
    created_by_name: str
    channel_id: str
    session_id: str
    def __init__(self, id: _Optional[str] = ..., agent_id: _Optional[str] = ..., key: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ..., access_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., scope: _Optional[_Union[MemoryScope, str]] = ..., description: _Optional[str] = ..., pinned: _Optional[bool] = ..., source: _Optional[_Union[MemorySource, str]] = ..., created_by_user_id: _Optional[str] = ..., created_by_name: _Optional[str] = ..., channel_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class ListMemoriesRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "category", "search", "pagination", "scope", "channel_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    category: MemoryCategory
    search: str
    pagination: _common_pb2.PaginationRequest
    scope: MemoryScope
    channel_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., search: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., scope: _Optional[_Union[MemoryScope, str]] = ..., channel_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class ListMemoriesResponse(_message.Message):
    __slots__ = ("memories", "pagination")
    MEMORIES_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    memories: _containers.RepeatedCompositeFieldContainer[MemoryInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, memories: _Optional[_Iterable[_Union[MemoryInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class CreateMemoryRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "key", "content", "category", "importance", "scope", "channel_id", "session_id", "description")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    key: str
    content: str
    category: MemoryCategory
    importance: float
    scope: MemoryScope
    channel_id: str
    session_id: str
    description: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., key: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ..., scope: _Optional[_Union[MemoryScope, str]] = ..., channel_id: _Optional[str] = ..., session_id: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class UpdateMemoryRequest(_message.Message):
    __slots__ = ("organization_id", "memory_id", "content", "category", "importance", "description")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    IMPORTANCE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    memory_id: str
    content: str
    category: MemoryCategory
    importance: float
    description: str
    def __init__(self, organization_id: _Optional[str] = ..., memory_id: _Optional[str] = ..., content: _Optional[str] = ..., category: _Optional[_Union[MemoryCategory, str]] = ..., importance: _Optional[float] = ..., description: _Optional[str] = ...) -> None: ...

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

class SetMemoryPinnedRequest(_message.Message):
    __slots__ = ("organization_id", "memory_id", "pinned")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    PINNED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    memory_id: str
    pinned: bool
    def __init__(self, organization_id: _Optional[str] = ..., memory_id: _Optional[str] = ..., pinned: _Optional[bool] = ...) -> None: ...

class SetMemoryPinnedResponse(_message.Message):
    __slots__ = ("memory",)
    MEMORY_FIELD_NUMBER: _ClassVar[int]
    memory: MemoryInfo
    def __init__(self, memory: _Optional[_Union[MemoryInfo, _Mapping]] = ...) -> None: ...

class GetMemorySharingRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetMemorySharingResponse(_message.Message):
    __slots__ = ("use_in_shared_spaces", "org_allows")
    USE_IN_SHARED_SPACES_FIELD_NUMBER: _ClassVar[int]
    ORG_ALLOWS_FIELD_NUMBER: _ClassVar[int]
    use_in_shared_spaces: bool
    org_allows: bool
    def __init__(self, use_in_shared_spaces: _Optional[bool] = ..., org_allows: _Optional[bool] = ...) -> None: ...

class SetMemorySharingRequest(_message.Message):
    __slots__ = ("organization_id", "use_in_shared_spaces")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USE_IN_SHARED_SPACES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    use_in_shared_spaces: bool
    def __init__(self, organization_id: _Optional[str] = ..., use_in_shared_spaces: _Optional[bool] = ...) -> None: ...

class SetMemorySharingResponse(_message.Message):
    __slots__ = ("use_in_shared_spaces", "org_allows")
    USE_IN_SHARED_SPACES_FIELD_NUMBER: _ClassVar[int]
    ORG_ALLOWS_FIELD_NUMBER: _ClassVar[int]
    use_in_shared_spaces: bool
    org_allows: bool
    def __init__(self, use_in_shared_spaces: _Optional[bool] = ..., org_allows: _Optional[bool] = ...) -> None: ...
