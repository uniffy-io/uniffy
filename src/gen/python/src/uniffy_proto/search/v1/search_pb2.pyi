from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SearchResultType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SEARCH_RESULT_TYPE_UNSPECIFIED: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_NOTE: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_FILE: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_CHAT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_USER: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_CALENDAR_EVENT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_PROJECT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_TASK: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_AGENT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_PROMPT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_CHAT_MESSAGE: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_ROOM: _ClassVar[SearchResultType]
SEARCH_RESULT_TYPE_UNSPECIFIED: SearchResultType
SEARCH_RESULT_TYPE_NOTE: SearchResultType
SEARCH_RESULT_TYPE_FILE: SearchResultType
SEARCH_RESULT_TYPE_CHAT: SearchResultType
SEARCH_RESULT_TYPE_USER: SearchResultType
SEARCH_RESULT_TYPE_CALENDAR_EVENT: SearchResultType
SEARCH_RESULT_TYPE_PROJECT: SearchResultType
SEARCH_RESULT_TYPE_TASK: SearchResultType
SEARCH_RESULT_TYPE_AGENT: SearchResultType
SEARCH_RESULT_TYPE_PROMPT: SearchResultType
SEARCH_RESULT_TYPE_CHAT_MESSAGE: SearchResultType
SEARCH_RESULT_TYPE_ROOM: SearchResultType

class SearchRequest(_message.Message):
    __slots__ = ("organization_id", "query", "type_filters", "limit", "tag_filters", "project_filters", "my_content_only", "owner_filter", "exclude_types")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTERS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    TAG_FILTERS_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FILTERS_FIELD_NUMBER: _ClassVar[int]
    MY_CONTENT_ONLY_FIELD_NUMBER: _ClassVar[int]
    OWNER_FILTER_FIELD_NUMBER: _ClassVar[int]
    EXCLUDE_TYPES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    query: str
    type_filters: _containers.RepeatedScalarFieldContainer[SearchResultType]
    limit: int
    tag_filters: _containers.RepeatedScalarFieldContainer[str]
    project_filters: _containers.RepeatedScalarFieldContainer[str]
    my_content_only: bool
    owner_filter: str
    exclude_types: _containers.RepeatedScalarFieldContainer[SearchResultType]
    def __init__(self, organization_id: _Optional[str] = ..., query: _Optional[str] = ..., type_filters: _Optional[_Iterable[_Union[SearchResultType, str]]] = ..., limit: _Optional[int] = ..., tag_filters: _Optional[_Iterable[str]] = ..., project_filters: _Optional[_Iterable[str]] = ..., my_content_only: _Optional[bool] = ..., owner_filter: _Optional[str] = ..., exclude_types: _Optional[_Iterable[_Union[SearchResultType, str]]] = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[SearchResultItem]
    def __init__(self, items: _Optional[_Iterable[_Union[SearchResultItem, _Mapping]]] = ...) -> None: ...

class SearchResultItem(_message.Message):
    __slots__ = ("urn", "title", "description", "type", "url", "score", "metadata", "tags")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URN_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    urn: str
    title: str
    description: str
    type: SearchResultType
    url: str
    score: float
    metadata: _containers.ScalarMap[str, str]
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, urn: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., url: _Optional[str] = ..., score: _Optional[float] = ..., metadata: _Optional[_Mapping[str, str]] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class IndexItemRequest(_message.Message):
    __slots__ = ("organization_id", "urn", "type", "title", "content", "url", "metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    urn: str
    type: SearchResultType
    title: str
    content: str
    url: str
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, organization_id: _Optional[str] = ..., urn: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., title: _Optional[str] = ..., content: _Optional[str] = ..., url: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...

class IndexItemResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class DeleteItemRequest(_message.Message):
    __slots__ = ("urn", "organization_id")
    URN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    urn: str
    organization_id: str
    def __init__(self, urn: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteItemResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetReferencesRequest(_message.Message):
    __slots__ = ("organization_id", "target_urn", "type_filters", "limit")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_URN_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTERS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    target_urn: str
    type_filters: _containers.RepeatedScalarFieldContainer[SearchResultType]
    limit: int
    def __init__(self, organization_id: _Optional[str] = ..., target_urn: _Optional[str] = ..., type_filters: _Optional[_Iterable[_Union[SearchResultType, str]]] = ..., limit: _Optional[int] = ...) -> None: ...

class GetReferencesResponse(_message.Message):
    __slots__ = ("items", "total_count")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[SearchResultItem]
    total_count: int
    def __init__(self, items: _Optional[_Iterable[_Union[SearchResultItem, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class ResolveUrnsRequest(_message.Message):
    __slots__ = ("organization_id", "urns")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    URNS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    urns: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., urns: _Optional[_Iterable[str]] = ...) -> None: ...

class ResolveUrnsResponse(_message.Message):
    __slots__ = ("resolved",)
    class ResolvedEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: UrnMetadata
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[UrnMetadata, _Mapping]] = ...) -> None: ...
    RESOLVED_FIELD_NUMBER: _ClassVar[int]
    resolved: _containers.MessageMap[str, UrnMetadata]
    def __init__(self, resolved: _Optional[_Mapping[str, UrnMetadata]] = ...) -> None: ...

class UrnMetadata(_message.Message):
    __slots__ = ("title", "description", "type", "url", "metadata", "status", "due_date", "assignee_name", "processing_status", "completed_tasks", "total_tasks", "member_count", "updated_by_name")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DUE_DATE_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSING_STATUS_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_TASKS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TASKS_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BY_NAME_FIELD_NUMBER: _ClassVar[int]
    title: str
    description: str
    type: SearchResultType
    url: str
    metadata: _containers.ScalarMap[str, str]
    status: str
    due_date: str
    assignee_name: str
    processing_status: str
    completed_tasks: int
    total_tasks: int
    member_count: int
    updated_by_name: str
    def __init__(self, title: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., url: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., status: _Optional[str] = ..., due_date: _Optional[str] = ..., assignee_name: _Optional[str] = ..., processing_status: _Optional[str] = ..., completed_tasks: _Optional[int] = ..., total_tasks: _Optional[int] = ..., member_count: _Optional[int] = ..., updated_by_name: _Optional[str] = ...) -> None: ...
