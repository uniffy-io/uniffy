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
    SEARCH_RESULT_TYPE_BOOK: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_CALENDAR_EVENT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_PASSWORD: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_WORKFLOW: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_SPACE: _ClassVar[SearchResultType]
SEARCH_RESULT_TYPE_UNSPECIFIED: SearchResultType
SEARCH_RESULT_TYPE_NOTE: SearchResultType
SEARCH_RESULT_TYPE_FILE: SearchResultType
SEARCH_RESULT_TYPE_CHAT: SearchResultType
SEARCH_RESULT_TYPE_USER: SearchResultType
SEARCH_RESULT_TYPE_BOOK: SearchResultType
SEARCH_RESULT_TYPE_CALENDAR_EVENT: SearchResultType
SEARCH_RESULT_TYPE_PASSWORD: SearchResultType
SEARCH_RESULT_TYPE_WORKFLOW: SearchResultType
SEARCH_RESULT_TYPE_SPACE: SearchResultType

class SearchRequest(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTERS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    query: str
    type_filters: _containers.RepeatedScalarFieldContainer[SearchResultType]
    limit: int
    def __init__(self, organization_id: _Optional[str] = ..., query: _Optional[str] = ..., type_filters: _Optional[_Iterable[_Union[SearchResultType, str]]] = ..., limit: _Optional[int] = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ()
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[SearchResultItem]
    def __init__(self, items: _Optional[_Iterable[_Union[SearchResultItem, _Mapping]]] = ...) -> None: ...

class SearchResultItem(_message.Message):
    __slots__ = ()
    class MetadataEntry(_message.Message):
        __slots__ = ()
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
    urn: str
    title: str
    description: str
    type: SearchResultType
    url: str
    score: float
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, urn: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., url: _Optional[str] = ..., score: _Optional[float] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...

class IndexItemRequest(_message.Message):
    __slots__ = ()
    class MetadataEntry(_message.Message):
        __slots__ = ()
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
    __slots__ = ()
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class DeleteItemRequest(_message.Message):
    __slots__ = ()
    URN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    urn: str
    organization_id: str
    def __init__(self, urn: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class DeleteItemResponse(_message.Message):
    __slots__ = ()
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
