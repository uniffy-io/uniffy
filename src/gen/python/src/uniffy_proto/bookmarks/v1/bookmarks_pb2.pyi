import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
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

class ListBookmarksRequest(_message.Message):
    __slots__ = ("organization_id", "page", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page: int
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListBookmarksResponse(_message.Message):
    __slots__ = ("bookmarks", "total_count")
    BOOKMARKS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    bookmarks: _containers.RepeatedCompositeFieldContainer[Bookmark]
    total_count: int
    def __init__(self, bookmarks: _Optional[_Iterable[_Union[Bookmark, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

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
