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

class TagSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TAG_SOURCE_UNSPECIFIED: _ClassVar[TagSource]
    TAG_SOURCE_MANUAL: _ClassVar[TagSource]
    TAG_SOURCE_INLINE: _ClassVar[TagSource]

class TagSort(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TAG_SORT_UNSPECIFIED: _ClassVar[TagSort]
    TAG_SORT_COUNT_DESC: _ClassVar[TagSort]
    TAG_SORT_COUNT_ASC: _ClassVar[TagSort]
    TAG_SORT_ALPHA_ASC: _ClassVar[TagSort]
    TAG_SORT_ALPHA_DESC: _ClassVar[TagSort]
    TAG_SORT_RECENT_DESC: _ClassVar[TagSort]
TAG_SOURCE_UNSPECIFIED: TagSource
TAG_SOURCE_MANUAL: TagSource
TAG_SOURCE_INLINE: TagSource
TAG_SORT_UNSPECIFIED: TagSort
TAG_SORT_COUNT_DESC: TagSort
TAG_SORT_COUNT_ASC: TagSort
TAG_SORT_ALPHA_ASC: TagSort
TAG_SORT_ALPHA_DESC: TagSort
TAG_SORT_RECENT_DESC: TagSort

class Tag(_message.Message):
    __slots__ = ("id", "organization_id", "name", "slug", "color", "description", "created_by", "created_at", "updated_at", "last_used_at", "usage_count", "urn")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    USAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    slug: str
    color: str
    description: str
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    usage_count: int
    urn: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., color: _Optional[str] = ..., description: _Optional[str] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., usage_count: _Optional[int] = ..., urn: _Optional[str] = ...) -> None: ...

class TagAssignment(_message.Message):
    __slots__ = ("tag_id", "content_urn", "content_type", "sources", "assigned_by", "assigned_at")
    TAG_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_URN_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    ASSIGNED_BY_FIELD_NUMBER: _ClassVar[int]
    ASSIGNED_AT_FIELD_NUMBER: _ClassVar[int]
    tag_id: str
    content_urn: str
    content_type: str
    sources: _containers.RepeatedScalarFieldContainer[str]
    assigned_by: str
    assigned_at: _timestamp_pb2.Timestamp
    def __init__(self, tag_id: _Optional[str] = ..., content_urn: _Optional[str] = ..., content_type: _Optional[str] = ..., sources: _Optional[_Iterable[str]] = ..., assigned_by: _Optional[str] = ..., assigned_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateTagRequest(_message.Message):
    __slots__ = ("organization_id", "name", "color", "description")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    color: str
    description: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class UpdateTagRequest(_message.Message):
    __slots__ = ("organization_id", "tag_id", "name", "color", "description")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    tag_id: str
    name: str
    color: str
    description: str
    def __init__(self, organization_id: _Optional[str] = ..., tag_id: _Optional[str] = ..., name: _Optional[str] = ..., color: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class DeleteTagRequest(_message.Message):
    __slots__ = ("organization_id", "tag_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    tag_id: str
    def __init__(self, organization_id: _Optional[str] = ..., tag_id: _Optional[str] = ...) -> None: ...

class DeleteTagResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetTagRequest(_message.Message):
    __slots__ = ("organization_id", "tag")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    tag: str
    def __init__(self, organization_id: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

class TagResponse(_message.Message):
    __slots__ = ("tag",)
    TAG_FIELD_NUMBER: _ClassVar[int]
    tag: Tag
    def __init__(self, tag: _Optional[_Union[Tag, _Mapping]] = ...) -> None: ...

class ListTagsRequest(_message.Message):
    __slots__ = ("organization_id", "content_types", "query", "sort", "page_size", "page_token")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_types: _containers.RepeatedScalarFieldContainer[_common_pb2.ContentType]
    query: str
    sort: TagSort
    page_size: int
    page_token: str
    def __init__(self, organization_id: _Optional[str] = ..., content_types: _Optional[_Iterable[_Union[_common_pb2.ContentType, str]]] = ..., query: _Optional[str] = ..., sort: _Optional[_Union[TagSort, str]] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListTagsResponse(_message.Message):
    __slots__ = ("tags", "next_page_token")
    TAGS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    tags: _containers.RepeatedCompositeFieldContainer[Tag]
    next_page_token: str
    def __init__(self, tags: _Optional[_Iterable[_Union[Tag, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class SuggestTagsRequest(_message.Message):
    __slots__ = ("organization_id", "prefix", "limit")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PREFIX_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    prefix: str
    limit: int
    def __init__(self, organization_id: _Optional[str] = ..., prefix: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class SuggestTagsResponse(_message.Message):
    __slots__ = ("tags",)
    TAGS_FIELD_NUMBER: _ClassVar[int]
    tags: _containers.RepeatedCompositeFieldContainer[Tag]
    def __init__(self, tags: _Optional[_Iterable[_Union[Tag, _Mapping]]] = ...) -> None: ...

class AssignTagsRequest(_message.Message):
    __slots__ = ("organization_id", "content_urn", "tag_ids", "source")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_URN_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_urn: str
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    source: TagSource
    def __init__(self, organization_id: _Optional[str] = ..., content_urn: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ..., source: _Optional[_Union[TagSource, str]] = ...) -> None: ...

class AssignTagsResponse(_message.Message):
    __slots__ = ("assignments",)
    ASSIGNMENTS_FIELD_NUMBER: _ClassVar[int]
    assignments: _containers.RepeatedCompositeFieldContainer[TagAssignment]
    def __init__(self, assignments: _Optional[_Iterable[_Union[TagAssignment, _Mapping]]] = ...) -> None: ...

class UnassignTagsRequest(_message.Message):
    __slots__ = ("organization_id", "content_urn", "tag_ids", "source")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_URN_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_urn: str
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    source: TagSource
    def __init__(self, organization_id: _Optional[str] = ..., content_urn: _Optional[str] = ..., tag_ids: _Optional[_Iterable[str]] = ..., source: _Optional[_Union[TagSource, str]] = ...) -> None: ...

class UnassignTagsResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetTagsForUrnsRequest(_message.Message):
    __slots__ = ("organization_id", "content_urns")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_URNS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_urns: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., content_urns: _Optional[_Iterable[str]] = ...) -> None: ...

class UrnTags(_message.Message):
    __slots__ = ("content_urn", "tags")
    CONTENT_URN_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    content_urn: str
    tags: _containers.RepeatedCompositeFieldContainer[Tag]
    def __init__(self, content_urn: _Optional[str] = ..., tags: _Optional[_Iterable[_Union[Tag, _Mapping]]] = ...) -> None: ...

class GetTagsForUrnsResponse(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[UrnTags]
    def __init__(self, entries: _Optional[_Iterable[_Union[UrnTags, _Mapping]]] = ...) -> None: ...

class ListContentByTagRequest(_message.Message):
    __slots__ = ("organization_id", "tag", "content_types", "page_size", "page_token", "criteria")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    tag: str
    content_types: _containers.RepeatedScalarFieldContainer[_common_pb2.ContentType]
    page_size: int
    page_token: str
    criteria: TagFilterCriteria
    def __init__(self, organization_id: _Optional[str] = ..., tag: _Optional[str] = ..., content_types: _Optional[_Iterable[_Union[_common_pb2.ContentType, str]]] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., criteria: _Optional[_Union[TagFilterCriteria, _Mapping]] = ...) -> None: ...

class TaggedContentItem(_message.Message):
    __slots__ = ("urn", "content_type", "title", "snippet", "updated_at", "assigned_at")
    URN_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    SNIPPET_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    ASSIGNED_AT_FIELD_NUMBER: _ClassVar[int]
    urn: str
    content_type: _common_pb2.ContentType
    title: str
    snippet: str
    updated_at: _timestamp_pb2.Timestamp
    assigned_at: _timestamp_pb2.Timestamp
    def __init__(self, urn: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., title: _Optional[str] = ..., snippet: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., assigned_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListContentByTagResponse(_message.Message):
    __slots__ = ("results", "next_page_token")
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[TaggedContentItem]
    next_page_token: str
    def __init__(self, results: _Optional[_Iterable[_Union[TaggedContentItem, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class MergeTagsRequest(_message.Message):
    __slots__ = ("organization_id", "source_tag_id", "target_tag_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TAG_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_TAG_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    source_tag_id: str
    target_tag_id: str
    def __init__(self, organization_id: _Optional[str] = ..., source_tag_id: _Optional[str] = ..., target_tag_id: _Optional[str] = ...) -> None: ...

class IconValue(_message.Message):
    __slots__ = ("type", "value")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    type: str
    value: str
    def __init__(self, type: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...

class TagFilterCriteria(_message.Message):
    __slots__ = ("tag_ids", "content_types", "owner_ids", "sources", "created_after", "created_before", "updated_after", "updated_before", "access_mode", "untagged_only")
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    OWNER_IDS_FIELD_NUMBER: _ClassVar[int]
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AFTER_FIELD_NUMBER: _ClassVar[int]
    CREATED_BEFORE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AFTER_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BEFORE_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    UNTAGGED_ONLY_FIELD_NUMBER: _ClassVar[int]
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    content_types: _containers.RepeatedScalarFieldContainer[_common_pb2.ContentType]
    owner_ids: _containers.RepeatedScalarFieldContainer[str]
    sources: _containers.RepeatedScalarFieldContainer[str]
    created_after: _timestamp_pb2.Timestamp
    created_before: _timestamp_pb2.Timestamp
    updated_after: _timestamp_pb2.Timestamp
    updated_before: _timestamp_pb2.Timestamp
    access_mode: _common_pb2.AccessMode
    untagged_only: bool
    def __init__(self, tag_ids: _Optional[_Iterable[str]] = ..., content_types: _Optional[_Iterable[_Union[_common_pb2.ContentType, str]]] = ..., owner_ids: _Optional[_Iterable[str]] = ..., sources: _Optional[_Iterable[str]] = ..., created_after: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_before: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_after: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_before: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., untagged_only: _Optional[bool] = ...) -> None: ...

class SavedTagFilter(_message.Message):
    __slots__ = ("id", "user_id", "organization_id", "name", "description", "icon", "criteria", "sort_by", "sort_order", "is_preset", "removed_tag_count", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    IS_PRESET_FIELD_NUMBER: _ClassVar[int]
    REMOVED_TAG_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    organization_id: str
    name: str
    description: str
    icon: IconValue
    criteria: TagFilterCriteria
    sort_by: str
    sort_order: str
    is_preset: bool
    removed_tag_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[TagFilterCriteria, _Mapping]] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ..., is_preset: _Optional[bool] = ..., removed_tag_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SavedTagFilterResponse(_message.Message):
    __slots__ = ("filter",)
    FILTER_FIELD_NUMBER: _ClassVar[int]
    filter: SavedTagFilter
    def __init__(self, filter: _Optional[_Union[SavedTagFilter, _Mapping]] = ...) -> None: ...

class CreateSavedTagFilterRequest(_message.Message):
    __slots__ = ("organization_id", "name", "description", "icon", "criteria", "sort_by", "sort_order")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    icon: IconValue
    criteria: TagFilterCriteria
    sort_by: str
    sort_order: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[TagFilterCriteria, _Mapping]] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ...) -> None: ...

class UpdateSavedTagFilterRequest(_message.Message):
    __slots__ = ("organization_id", "filter_id", "name", "description", "icon", "criteria", "sort_by", "sort_order")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILTER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    filter_id: str
    name: str
    description: str
    icon: IconValue
    criteria: TagFilterCriteria
    sort_by: str
    sort_order: str
    def __init__(self, organization_id: _Optional[str] = ..., filter_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[_Union[IconValue, _Mapping]] = ..., criteria: _Optional[_Union[TagFilterCriteria, _Mapping]] = ..., sort_by: _Optional[str] = ..., sort_order: _Optional[str] = ...) -> None: ...

class DeleteSavedTagFilterRequest(_message.Message):
    __slots__ = ("organization_id", "filter_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    FILTER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    filter_id: str
    def __init__(self, organization_id: _Optional[str] = ..., filter_id: _Optional[str] = ...) -> None: ...

class DeleteSavedTagFilterResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListSavedTagFiltersRequest(_message.Message):
    __slots__ = ("organization_id", "include_presets")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_PRESETS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    include_presets: bool
    def __init__(self, organization_id: _Optional[str] = ..., include_presets: _Optional[bool] = ...) -> None: ...

class ListSavedTagFiltersResponse(_message.Message):
    __slots__ = ("filters",)
    FILTERS_FIELD_NUMBER: _ClassVar[int]
    filters: _containers.RepeatedCompositeFieldContainer[SavedTagFilter]
    def __init__(self, filters: _Optional[_Iterable[_Union[SavedTagFilter, _Mapping]]] = ...) -> None: ...
