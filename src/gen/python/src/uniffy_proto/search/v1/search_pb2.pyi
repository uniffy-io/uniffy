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
    SEARCH_RESULT_TYPE_AGENT_CHAT: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_TAG: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_FOLDER: _ClassVar[SearchResultType]
    SEARCH_RESULT_TYPE_AGENT_FOLDER: _ClassVar[SearchResultType]
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
SEARCH_RESULT_TYPE_AGENT_CHAT: SearchResultType
SEARCH_RESULT_TYPE_TAG: SearchResultType
SEARCH_RESULT_TYPE_FOLDER: SearchResultType
SEARCH_RESULT_TYPE_AGENT_FOLDER: SearchResultType

class SearchRequest(_message.Message):
    __slots__ = ("organization_id", "query", "type_filters", "limit", "tag_filters", "project_filters", "my_content_only", "owner_filter", "metadata_filters", "offset", "type_priority")
    class MetadataFiltersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTERS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    TAG_FILTERS_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FILTERS_FIELD_NUMBER: _ClassVar[int]
    MY_CONTENT_ONLY_FIELD_NUMBER: _ClassVar[int]
    OWNER_FILTER_FIELD_NUMBER: _ClassVar[int]
    METADATA_FILTERS_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    TYPE_PRIORITY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    query: str
    type_filters: _containers.RepeatedScalarFieldContainer[SearchResultType]
    limit: int
    tag_filters: _containers.RepeatedScalarFieldContainer[str]
    project_filters: _containers.RepeatedScalarFieldContainer[str]
    my_content_only: bool
    owner_filter: str
    metadata_filters: _containers.ScalarMap[str, str]
    offset: int
    type_priority: _containers.RepeatedScalarFieldContainer[SearchResultType]
    def __init__(self, organization_id: _Optional[str] = ..., query: _Optional[str] = ..., type_filters: _Optional[_Iterable[_Union[SearchResultType, str]]] = ..., limit: _Optional[int] = ..., tag_filters: _Optional[_Iterable[str]] = ..., project_filters: _Optional[_Iterable[str]] = ..., my_content_only: _Optional[bool] = ..., owner_filter: _Optional[str] = ..., metadata_filters: _Optional[_Mapping[str, str]] = ..., offset: _Optional[int] = ..., type_priority: _Optional[_Iterable[_Union[SearchResultType, str]]] = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ("items", "total_count")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[SearchResultItem]
    total_count: int
    def __init__(self, items: _Optional[_Iterable[_Union[SearchResultItem, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class SearchResultItem(_message.Message):
    __slots__ = ("urn", "title", "description", "type", "url", "score", "metadata", "tags", "title_highlighted", "description_highlighted")
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
    TITLE_HIGHLIGHTED_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_HIGHLIGHTED_FIELD_NUMBER: _ClassVar[int]
    urn: str
    title: str
    description: str
    type: SearchResultType
    url: str
    score: float
    metadata: _containers.ScalarMap[str, str]
    tags: _containers.RepeatedScalarFieldContainer[str]
    title_highlighted: str
    description_highlighted: str
    def __init__(self, urn: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., url: _Optional[str] = ..., score: _Optional[float] = ..., metadata: _Optional[_Mapping[str, str]] = ..., tags: _Optional[_Iterable[str]] = ..., title_highlighted: _Optional[str] = ..., description_highlighted: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("title", "description", "type", "url", "metadata", "status", "due_date", "assignee_name", "processing_status", "completed_tasks", "total_tasks", "member_count", "updated_by_name", "priority", "priority_label", "priority_color", "status_label", "status_color", "task_type", "task_number", "project_name", "project_slug", "project_color", "subtask_completed", "subtask_total", "blocked_by_count", "event_start_time", "event_end_time", "event_is_all_day", "event_location", "event_meeting_url", "event_channel_id", "file_mime_type", "file_size", "note_node_type", "channel_type", "agent_emoji", "agent_theme_color", "user_avatar_url", "user_email", "assignee_ids", "content_tags", "urn_status")
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
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_LABEL_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_COLOR_FIELD_NUMBER: _ClassVar[int]
    STATUS_LABEL_FIELD_NUMBER: _ClassVar[int]
    STATUS_COLOR_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    TASK_NUMBER_FIELD_NUMBER: _ClassVar[int]
    PROJECT_NAME_FIELD_NUMBER: _ClassVar[int]
    PROJECT_SLUG_FIELD_NUMBER: _ClassVar[int]
    PROJECT_COLOR_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_COMPLETED_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_TOTAL_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_BY_COUNT_FIELD_NUMBER: _ClassVar[int]
    EVENT_START_TIME_FIELD_NUMBER: _ClassVar[int]
    EVENT_END_TIME_FIELD_NUMBER: _ClassVar[int]
    EVENT_IS_ALL_DAY_FIELD_NUMBER: _ClassVar[int]
    EVENT_LOCATION_FIELD_NUMBER: _ClassVar[int]
    EVENT_MEETING_URL_FIELD_NUMBER: _ClassVar[int]
    EVENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_FIELD_NUMBER: _ClassVar[int]
    NOTE_NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_TYPE_FIELD_NUMBER: _ClassVar[int]
    AGENT_EMOJI_FIELD_NUMBER: _ClassVar[int]
    AGENT_THEME_COLOR_FIELD_NUMBER: _ClassVar[int]
    USER_AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    USER_EMAIL_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_IDS_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TAGS_FIELD_NUMBER: _ClassVar[int]
    URN_STATUS_FIELD_NUMBER: _ClassVar[int]
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
    priority: str
    priority_label: str
    priority_color: str
    status_label: str
    status_color: str
    task_type: str
    task_number: int
    project_name: str
    project_slug: str
    project_color: str
    subtask_completed: int
    subtask_total: int
    blocked_by_count: int
    event_start_time: str
    event_end_time: str
    event_is_all_day: bool
    event_location: str
    event_meeting_url: str
    event_channel_id: str
    file_mime_type: str
    file_size: int
    note_node_type: str
    channel_type: str
    agent_emoji: str
    agent_theme_color: str
    user_avatar_url: str
    user_email: str
    assignee_ids: _containers.RepeatedScalarFieldContainer[str]
    content_tags: _containers.RepeatedScalarFieldContainer[str]
    urn_status: str
    def __init__(self, title: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[SearchResultType, str]] = ..., url: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., status: _Optional[str] = ..., due_date: _Optional[str] = ..., assignee_name: _Optional[str] = ..., processing_status: _Optional[str] = ..., completed_tasks: _Optional[int] = ..., total_tasks: _Optional[int] = ..., member_count: _Optional[int] = ..., updated_by_name: _Optional[str] = ..., priority: _Optional[str] = ..., priority_label: _Optional[str] = ..., priority_color: _Optional[str] = ..., status_label: _Optional[str] = ..., status_color: _Optional[str] = ..., task_type: _Optional[str] = ..., task_number: _Optional[int] = ..., project_name: _Optional[str] = ..., project_slug: _Optional[str] = ..., project_color: _Optional[str] = ..., subtask_completed: _Optional[int] = ..., subtask_total: _Optional[int] = ..., blocked_by_count: _Optional[int] = ..., event_start_time: _Optional[str] = ..., event_end_time: _Optional[str] = ..., event_is_all_day: _Optional[bool] = ..., event_location: _Optional[str] = ..., event_meeting_url: _Optional[str] = ..., event_channel_id: _Optional[str] = ..., file_mime_type: _Optional[str] = ..., file_size: _Optional[int] = ..., note_node_type: _Optional[str] = ..., channel_type: _Optional[str] = ..., agent_emoji: _Optional[str] = ..., agent_theme_color: _Optional[str] = ..., user_avatar_url: _Optional[str] = ..., user_email: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., content_tags: _Optional[_Iterable[str]] = ..., urn_status: _Optional[str] = ...) -> None: ...
