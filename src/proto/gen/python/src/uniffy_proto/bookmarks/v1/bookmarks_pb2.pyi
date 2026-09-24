import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from search.v1 import search_pb2 as _search_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ToggleBookmarkRequest(_message.Message):
    __slots__ = ("organization_id", "urn")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    urn: str
    def __init__(self, organization_id: _Optional[str] = ..., urn: _Optional[str] = ...) -> None: ...

class ToggleBookmarkResponse(_message.Message):
    __slots__ = ("is_bookmarked", "bookmark")
    IS_BOOKMARKED_FIELD_NUMBER: _ClassVar[int]
    BOOKMARK_FIELD_NUMBER: _ClassVar[int]
    is_bookmarked: bool
    bookmark: Bookmark
    def __init__(self, is_bookmarked: _Optional[bool] = ..., bookmark: _Optional[_Union[Bookmark, _Mapping]] = ...) -> None: ...

class ListBookmarkItemsRequest(_message.Message):
    __slots__ = ("organization_id", "content_types", "page_size", "page_token")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_types: _containers.RepeatedScalarFieldContainer[_common_pb2.ContentType]
    page_size: int
    page_token: str
    def __init__(self, organization_id: _Optional[str] = ..., content_types: _Optional[_Iterable[_Union[_common_pb2.ContentType, str]]] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListBookmarkItemsResponse(_message.Message):
    __slots__ = ("items", "next_page_token")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[BookmarkItem]
    next_page_token: str
    def __init__(self, items: _Optional[_Iterable[_Union[BookmarkItem, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class BookmarkItem(_message.Message):
    __slots__ = ("bookmark", "content")
    BOOKMARK_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    bookmark: Bookmark
    content: _search_pb2.UrnMetadata
    def __init__(self, bookmark: _Optional[_Union[Bookmark, _Mapping]] = ..., content: _Optional[_Union[_search_pb2.UrnMetadata, _Mapping]] = ...) -> None: ...

class BulkCheckBookmarksRequest(_message.Message):
    __slots__ = ("organization_id", "urns")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    URNS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    urns: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., urns: _Optional[_Iterable[str]] = ...) -> None: ...

class BulkCheckBookmarksResponse(_message.Message):
    __slots__ = ("bookmarked_urns",)
    class BookmarkedUrnsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: bool
        def __init__(self, key: _Optional[str] = ..., value: _Optional[bool] = ...) -> None: ...
    BOOKMARKED_URNS_FIELD_NUMBER: _ClassVar[int]
    bookmarked_urns: _containers.ScalarMap[str, bool]
    def __init__(self, bookmarked_urns: _Optional[_Mapping[str, bool]] = ...) -> None: ...

class Bookmark(_message.Message):
    __slots__ = ("id", "user_id", "organization_id", "urn", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    organization_id: str
    urn: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., urn: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
