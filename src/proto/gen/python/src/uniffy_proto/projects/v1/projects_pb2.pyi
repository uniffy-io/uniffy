import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from tags.v1 import tags_pb2 as _tags_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FieldType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FIELD_TYPE_UNSPECIFIED: _ClassVar[FieldType]
    FIELD_TYPE_TEXT: _ClassVar[FieldType]
    FIELD_TYPE_NUMBER: _ClassVar[FieldType]
    FIELD_TYPE_SINGLE_SELECT: _ClassVar[FieldType]
    FIELD_TYPE_MULTI_SELECT: _ClassVar[FieldType]
    FIELD_TYPE_DATE: _ClassVar[FieldType]
    FIELD_TYPE_PERSON: _ClassVar[FieldType]
    FIELD_TYPE_REFERENCE: _ClassVar[FieldType]

class ViewType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VIEW_TYPE_UNSPECIFIED: _ClassVar[ViewType]
    VIEW_TYPE_TABLE: _ClassVar[ViewType]
    VIEW_TYPE_BOARD: _ClassVar[ViewType]
    VIEW_TYPE_ROADMAP: _ClassVar[ViewType]
    VIEW_TYPE_BACKLOG: _ClassVar[ViewType]
    VIEW_TYPE_GRAPH: _ClassVar[ViewType]
    VIEW_TYPE_RESOURCES: _ClassVar[ViewType]

class ViewVisibility(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VIEW_VISIBILITY_UNSPECIFIED: _ClassVar[ViewVisibility]
    VIEW_VISIBILITY_PERSONAL: _ClassVar[ViewVisibility]
    VIEW_VISIBILITY_SHARED: _ClassVar[ViewVisibility]

class TaskPseudoField(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TASK_PSEUDO_FIELD_UNSPECIFIED: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_TAGS: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_SPRINT: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_TASK_TYPE: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_CREATOR: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_PARENT: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_EPIC: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_HAS_SUBTASKS: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_DEPTH: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_IS_MILESTONE: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_IS_BLOCKED: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_BLOCKED_BY: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_CREATED_AT: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_UPDATED_AT: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_COMPLETED_AT: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: _ClassVar[TaskPseudoField]
    TASK_PSEUDO_FIELD_NUMBER: _ClassVar[TaskPseudoField]

class TaskFilterOperator(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TASK_FILTER_OPERATOR_UNSPECIFIED: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_NOT: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_ANY_OF: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_NONE_OF: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_ALL_OF: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_CONTAINS: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_NOT_CONTAINS: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_EMPTY: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_IS_NOT_EMPTY: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_GREATER_THAN: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_LESS_THAN: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_BETWEEN: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_BEFORE: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_AFTER: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_ON_OR_BEFORE: _ClassVar[TaskFilterOperator]
    TASK_FILTER_OPERATOR_ON_OR_AFTER: _ClassVar[TaskFilterOperator]

class FilterLogic(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILTER_LOGIC_UNSPECIFIED: _ClassVar[FilterLogic]
    FILTER_LOGIC_AND: _ClassVar[FilterLogic]
    FILTER_LOGIC_OR: _ClassVar[FilterLogic]

class SortDirection(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SORT_DIRECTION_UNSPECIFIED: _ClassVar[SortDirection]
    SORT_DIRECTION_ASC: _ClassVar[SortDirection]
    SORT_DIRECTION_DESC: _ClassVar[SortDirection]

class RelativeDateAnchor(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RELATIVE_DATE_ANCHOR_UNSPECIFIED: _ClassVar[RelativeDateAnchor]
    RELATIVE_DATE_ANCHOR_TODAY: _ClassVar[RelativeDateAnchor]
    RELATIVE_DATE_ANCHOR_START_OF_WEEK: _ClassVar[RelativeDateAnchor]
    RELATIVE_DATE_ANCHOR_END_OF_WEEK: _ClassVar[RelativeDateAnchor]
    RELATIVE_DATE_ANCHOR_START_OF_MONTH: _ClassVar[RelativeDateAnchor]
    RELATIVE_DATE_ANCHOR_END_OF_MONTH: _ClassVar[RelativeDateAnchor]

class RoadmapZoom(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROADMAP_ZOOM_UNSPECIFIED: _ClassVar[RoadmapZoom]
    ROADMAP_ZOOM_DAY: _ClassVar[RoadmapZoom]
    ROADMAP_ZOOM_WEEK: _ClassVar[RoadmapZoom]
    ROADMAP_ZOOM_MONTH: _ClassVar[RoadmapZoom]

class ActivityAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ACTIVITY_ACTION_UNSPECIFIED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_CREATED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_STATUS_CHANGED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_PRIORITY_CHANGED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_FIELD_UPDATED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_BLOCKED_BY_ADDED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_BLOCKED_BY_REMOVED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_ASSIGNED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_TYPE_CHANGED: _ClassVar[ActivityAction]
    ACTIVITY_ACTION_SPRINT_CHANGED: _ClassVar[ActivityAction]
FIELD_TYPE_UNSPECIFIED: FieldType
FIELD_TYPE_TEXT: FieldType
FIELD_TYPE_NUMBER: FieldType
FIELD_TYPE_SINGLE_SELECT: FieldType
FIELD_TYPE_MULTI_SELECT: FieldType
FIELD_TYPE_DATE: FieldType
FIELD_TYPE_PERSON: FieldType
FIELD_TYPE_REFERENCE: FieldType
VIEW_TYPE_UNSPECIFIED: ViewType
VIEW_TYPE_TABLE: ViewType
VIEW_TYPE_BOARD: ViewType
VIEW_TYPE_ROADMAP: ViewType
VIEW_TYPE_BACKLOG: ViewType
VIEW_TYPE_GRAPH: ViewType
VIEW_TYPE_RESOURCES: ViewType
VIEW_VISIBILITY_UNSPECIFIED: ViewVisibility
VIEW_VISIBILITY_PERSONAL: ViewVisibility
VIEW_VISIBILITY_SHARED: ViewVisibility
TASK_PSEUDO_FIELD_UNSPECIFIED: TaskPseudoField
TASK_PSEUDO_FIELD_TAGS: TaskPseudoField
TASK_PSEUDO_FIELD_SPRINT: TaskPseudoField
TASK_PSEUDO_FIELD_TASK_TYPE: TaskPseudoField
TASK_PSEUDO_FIELD_CREATOR: TaskPseudoField
TASK_PSEUDO_FIELD_PARENT: TaskPseudoField
TASK_PSEUDO_FIELD_EPIC: TaskPseudoField
TASK_PSEUDO_FIELD_HAS_SUBTASKS: TaskPseudoField
TASK_PSEUDO_FIELD_DEPTH: TaskPseudoField
TASK_PSEUDO_FIELD_IS_MILESTONE: TaskPseudoField
TASK_PSEUDO_FIELD_IS_BLOCKED: TaskPseudoField
TASK_PSEUDO_FIELD_BLOCKED_BY: TaskPseudoField
TASK_PSEUDO_FIELD_CREATED_AT: TaskPseudoField
TASK_PSEUDO_FIELD_UPDATED_AT: TaskPseudoField
TASK_PSEUDO_FIELD_COMPLETED_AT: TaskPseudoField
TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: TaskPseudoField
TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: TaskPseudoField
TASK_PSEUDO_FIELD_NUMBER: TaskPseudoField
TASK_FILTER_OPERATOR_UNSPECIFIED: TaskFilterOperator
TASK_FILTER_OPERATOR_IS: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_NOT: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_ANY_OF: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_NONE_OF: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_ALL_OF: TaskFilterOperator
TASK_FILTER_OPERATOR_CONTAINS: TaskFilterOperator
TASK_FILTER_OPERATOR_NOT_CONTAINS: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_EMPTY: TaskFilterOperator
TASK_FILTER_OPERATOR_IS_NOT_EMPTY: TaskFilterOperator
TASK_FILTER_OPERATOR_GREATER_THAN: TaskFilterOperator
TASK_FILTER_OPERATOR_LESS_THAN: TaskFilterOperator
TASK_FILTER_OPERATOR_BETWEEN: TaskFilterOperator
TASK_FILTER_OPERATOR_BEFORE: TaskFilterOperator
TASK_FILTER_OPERATOR_AFTER: TaskFilterOperator
TASK_FILTER_OPERATOR_ON_OR_BEFORE: TaskFilterOperator
TASK_FILTER_OPERATOR_ON_OR_AFTER: TaskFilterOperator
FILTER_LOGIC_UNSPECIFIED: FilterLogic
FILTER_LOGIC_AND: FilterLogic
FILTER_LOGIC_OR: FilterLogic
SORT_DIRECTION_UNSPECIFIED: SortDirection
SORT_DIRECTION_ASC: SortDirection
SORT_DIRECTION_DESC: SortDirection
RELATIVE_DATE_ANCHOR_UNSPECIFIED: RelativeDateAnchor
RELATIVE_DATE_ANCHOR_TODAY: RelativeDateAnchor
RELATIVE_DATE_ANCHOR_START_OF_WEEK: RelativeDateAnchor
RELATIVE_DATE_ANCHOR_END_OF_WEEK: RelativeDateAnchor
RELATIVE_DATE_ANCHOR_START_OF_MONTH: RelativeDateAnchor
RELATIVE_DATE_ANCHOR_END_OF_MONTH: RelativeDateAnchor
ROADMAP_ZOOM_UNSPECIFIED: RoadmapZoom
ROADMAP_ZOOM_DAY: RoadmapZoom
ROADMAP_ZOOM_WEEK: RoadmapZoom
ROADMAP_ZOOM_MONTH: RoadmapZoom
ACTIVITY_ACTION_UNSPECIFIED: ActivityAction
ACTIVITY_ACTION_CREATED: ActivityAction
ACTIVITY_ACTION_STATUS_CHANGED: ActivityAction
ACTIVITY_ACTION_PRIORITY_CHANGED: ActivityAction
ACTIVITY_ACTION_FIELD_UPDATED: ActivityAction
ACTIVITY_ACTION_BLOCKED_BY_ADDED: ActivityAction
ACTIVITY_ACTION_BLOCKED_BY_REMOVED: ActivityAction
ACTIVITY_ACTION_ASSIGNED: ActivityAction
ACTIVITY_ACTION_TYPE_CHANGED: ActivityAction
ACTIVITY_ACTION_SPRINT_CHANGED: ActivityAction

class Project(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "name", "description", "icon", "color", "access_mode", "field_definitions", "views", "default_view_id", "created_at", "updated_at", "deleted_at", "urn", "user_role", "slug", "type_field_schemas", "baseline_role", "tags", "task_count", "completed_task_count", "member_count", "overdue_task_count", "estimated_minutes", "time_spent_minutes")
    class TypeFieldSchemasEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: TypeFieldSchema
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[TypeFieldSchema, _Mapping]] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    FIELD_DEFINITIONS_FIELD_NUMBER: _ClassVar[int]
    VIEWS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_SCHEMAS_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    TASK_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_TASK_COUNT_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    OVERDUE_TASK_COUNT_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TIME_SPENT_MINUTES_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    name: str
    description: str
    icon: str
    color: str
    access_mode: _common_pb2.AccessMode
    field_definitions: _containers.RepeatedCompositeFieldContainer[FieldDefinition]
    views: _containers.RepeatedCompositeFieldContainer[ViewConfig]
    default_view_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    urn: str
    user_role: _common_pb2.ContentRole
    slug: str
    type_field_schemas: _containers.MessageMap[str, TypeFieldSchema]
    baseline_role: _common_pb2.ContentRole
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    task_count: int
    completed_task_count: int
    member_count: int
    overdue_task_count: int
    estimated_minutes: int
    time_spent_minutes: int
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., field_definitions: _Optional[_Iterable[_Union[FieldDefinition, _Mapping]]] = ..., views: _Optional[_Iterable[_Union[ViewConfig, _Mapping]]] = ..., default_view_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., urn: _Optional[str] = ..., user_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., slug: _Optional[str] = ..., type_field_schemas: _Optional[_Mapping[str, TypeFieldSchema]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ..., task_count: _Optional[int] = ..., completed_task_count: _Optional[int] = ..., member_count: _Optional[int] = ..., overdue_task_count: _Optional[int] = ..., estimated_minutes: _Optional[int] = ..., time_spent_minutes: _Optional[int] = ...) -> None: ...

class Task(_message.Message):
    __slots__ = ("id", "project_id", "organization_id", "owner_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "completed_at", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "sort_order", "field_values", "outgoing_references", "created_at", "updated_at", "deleted_at", "urn", "number", "task_type", "sprint_id", "user_role", "subtask_total", "subtask_completed", "estimated_minutes", "time_spent_minutes", "tags")
    class FieldValuesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_IDS_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    DUE_DATE_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_BY_TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_MILESTONE_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_RULE_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    FIELD_VALUES_FIELD_NUMBER: _ClassVar[int]
    OUTGOING_REFERENCES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    NUMBER_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_TOTAL_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_COMPLETED_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TIME_SPENT_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    id: str
    project_id: str
    organization_id: str
    owner_id: str
    title: str
    description: str
    status: str
    priority: str
    assignee_ids: _containers.RepeatedScalarFieldContainer[str]
    start_date: str
    due_date: str
    completed_at: _timestamp_pb2.Timestamp
    parent_id: str
    blocked_by_task_ids: _containers.RepeatedScalarFieldContainer[str]
    is_milestone: bool
    recurrence_rule: str
    sort_order: int
    field_values: _containers.ScalarMap[str, str]
    outgoing_references: _containers.RepeatedScalarFieldContainer[str]
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    urn: str
    number: int
    task_type: str
    sprint_id: str
    user_role: _common_pb2.ContentRole
    subtask_total: int
    subtask_completed: int
    estimated_minutes: int
    time_spent_minutes: int
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., sort_order: _Optional[int] = ..., field_values: _Optional[_Mapping[str, str]] = ..., outgoing_references: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., urn: _Optional[str] = ..., number: _Optional[int] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ..., user_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., subtask_total: _Optional[int] = ..., subtask_completed: _Optional[int] = ..., estimated_minutes: _Optional[int] = ..., time_spent_minutes: _Optional[int] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ...) -> None: ...

class FieldDefinition(_message.Message):
    __slots__ = ("id", "project_id", "name", "type", "is_required", "is_system", "sort_order", "config_json", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    project_id: str
    name: str
    type: FieldType
    is_required: bool
    is_system: bool
    sort_order: int
    config_json: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., type: _Optional[_Union[FieldType, str]] = ..., is_required: _Optional[bool] = ..., is_system: _Optional[bool] = ..., sort_order: _Optional[int] = ..., config_json: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class TypeFieldSchema(_message.Message):
    __slots__ = ("shown_field_ids", "required_field_ids")
    SHOWN_FIELD_IDS_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_FIELD_IDS_FIELD_NUMBER: _ClassVar[int]
    shown_field_ids: _containers.RepeatedScalarFieldContainer[str]
    required_field_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, shown_field_ids: _Optional[_Iterable[str]] = ..., required_field_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class TaskFieldRef(_message.Message):
    __slots__ = ("field_id", "pseudo")
    FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    PSEUDO_FIELD_NUMBER: _ClassVar[int]
    field_id: str
    pseudo: TaskPseudoField
    def __init__(self, field_id: _Optional[str] = ..., pseudo: _Optional[_Union[TaskPseudoField, str]] = ...) -> None: ...

class TaskFilterIdSet(_message.Message):
    __slots__ = ("ids", "include_current_user", "include_empty", "include_active_sprint")
    IDS_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_CURRENT_USER_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_EMPTY_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_ACTIVE_SPRINT_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    include_current_user: bool
    include_empty: bool
    include_active_sprint: bool
    def __init__(self, ids: _Optional[_Iterable[str]] = ..., include_current_user: _Optional[bool] = ..., include_empty: _Optional[bool] = ..., include_active_sprint: _Optional[bool] = ...) -> None: ...

class RelativeDate(_message.Message):
    __slots__ = ("anchor", "offset_days")
    ANCHOR_FIELD_NUMBER: _ClassVar[int]
    OFFSET_DAYS_FIELD_NUMBER: _ClassVar[int]
    anchor: RelativeDateAnchor
    offset_days: int
    def __init__(self, anchor: _Optional[_Union[RelativeDateAnchor, str]] = ..., offset_days: _Optional[int] = ...) -> None: ...

class TaskFilterDate(_message.Message):
    __slots__ = ("fixed", "relative")
    FIXED_FIELD_NUMBER: _ClassVar[int]
    RELATIVE_FIELD_NUMBER: _ClassVar[int]
    fixed: str
    relative: RelativeDate
    def __init__(self, fixed: _Optional[str] = ..., relative: _Optional[_Union[RelativeDate, _Mapping]] = ...) -> None: ...

class TaskFilterDateRange(_message.Message):
    __slots__ = ("start", "end")
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    start: TaskFilterDate
    end: TaskFilterDate
    def __init__(self, start: _Optional[_Union[TaskFilterDate, _Mapping]] = ..., end: _Optional[_Union[TaskFilterDate, _Mapping]] = ...) -> None: ...

class TaskFilterNumberRange(_message.Message):
    __slots__ = ("min", "max")
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    min: float
    max: float
    def __init__(self, min: _Optional[float] = ..., max: _Optional[float] = ...) -> None: ...

class TaskFilterValue(_message.Message):
    __slots__ = ("ids", "text", "number", "number_range", "date", "date_range", "flag")
    IDS_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    NUMBER_FIELD_NUMBER: _ClassVar[int]
    NUMBER_RANGE_FIELD_NUMBER: _ClassVar[int]
    DATE_FIELD_NUMBER: _ClassVar[int]
    DATE_RANGE_FIELD_NUMBER: _ClassVar[int]
    FLAG_FIELD_NUMBER: _ClassVar[int]
    ids: TaskFilterIdSet
    text: str
    number: float
    number_range: TaskFilterNumberRange
    date: TaskFilterDate
    date_range: TaskFilterDateRange
    flag: bool
    def __init__(self, ids: _Optional[_Union[TaskFilterIdSet, _Mapping]] = ..., text: _Optional[str] = ..., number: _Optional[float] = ..., number_range: _Optional[_Union[TaskFilterNumberRange, _Mapping]] = ..., date: _Optional[_Union[TaskFilterDate, _Mapping]] = ..., date_range: _Optional[_Union[TaskFilterDateRange, _Mapping]] = ..., flag: _Optional[bool] = ...) -> None: ...

class TaskFilterCondition(_message.Message):
    __slots__ = ("field", "operator", "value")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    field: TaskFieldRef
    operator: TaskFilterOperator
    value: TaskFilterValue
    def __init__(self, field: _Optional[_Union[TaskFieldRef, _Mapping]] = ..., operator: _Optional[_Union[TaskFilterOperator, str]] = ..., value: _Optional[_Union[TaskFilterValue, _Mapping]] = ...) -> None: ...

class TaskFilterNode(_message.Message):
    __slots__ = ("condition", "group")
    CONDITION_FIELD_NUMBER: _ClassVar[int]
    GROUP_FIELD_NUMBER: _ClassVar[int]
    condition: TaskFilterCondition
    group: TaskFilterGroup
    def __init__(self, condition: _Optional[_Union[TaskFilterCondition, _Mapping]] = ..., group: _Optional[_Union[TaskFilterGroup, _Mapping]] = ...) -> None: ...

class TaskFilterGroup(_message.Message):
    __slots__ = ("logic", "nodes")
    LOGIC_FIELD_NUMBER: _ClassVar[int]
    NODES_FIELD_NUMBER: _ClassVar[int]
    logic: FilterLogic
    nodes: _containers.RepeatedCompositeFieldContainer[TaskFilterNode]
    def __init__(self, logic: _Optional[_Union[FilterLogic, str]] = ..., nodes: _Optional[_Iterable[_Union[TaskFilterNode, _Mapping]]] = ...) -> None: ...

class TaskSort(_message.Message):
    __slots__ = ("field", "direction")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    DIRECTION_FIELD_NUMBER: _ClassVar[int]
    field: TaskFieldRef
    direction: SortDirection
    def __init__(self, field: _Optional[_Union[TaskFieldRef, _Mapping]] = ..., direction: _Optional[_Union[SortDirection, str]] = ...) -> None: ...

class TaskGroupBy(_message.Message):
    __slots__ = ("field", "direction", "hide_empty")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    DIRECTION_FIELD_NUMBER: _ClassVar[int]
    HIDE_EMPTY_FIELD_NUMBER: _ClassVar[int]
    field: TaskFieldRef
    direction: SortDirection
    hide_empty: bool
    def __init__(self, field: _Optional[_Union[TaskFieldRef, _Mapping]] = ..., direction: _Optional[_Union[SortDirection, str]] = ..., hide_empty: _Optional[bool] = ...) -> None: ...

class TableLayout(_message.Message):
    __slots__ = ("flat",)
    FLAT_FIELD_NUMBER: _ClassVar[int]
    flat: bool
    def __init__(self, flat: _Optional[bool] = ...) -> None: ...

class BoardLayout(_message.Message):
    __slots__ = ("column_field_id",)
    COLUMN_FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    column_field_id: str
    def __init__(self, column_field_id: _Optional[str] = ...) -> None: ...

class RoadmapLayout(_message.Message):
    __slots__ = ("zoom",)
    ZOOM_FIELD_NUMBER: _ClassVar[int]
    zoom: RoadmapZoom
    def __init__(self, zoom: _Optional[_Union[RoadmapZoom, str]] = ...) -> None: ...

class BacklogLayout(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GraphLayout(_message.Message):
    __slots__ = ("hide_parent_edges",)
    HIDE_PARENT_EDGES_FIELD_NUMBER: _ClassVar[int]
    hide_parent_edges: bool
    def __init__(self, hide_parent_edges: _Optional[bool] = ...) -> None: ...

class ResourcesLayout(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ColumnWidth(_message.Message):
    __slots__ = ("field", "width")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    field: TaskFieldRef
    width: int
    def __init__(self, field: _Optional[_Union[TaskFieldRef, _Mapping]] = ..., width: _Optional[int] = ...) -> None: ...

class ViewDefinition(_message.Message):
    __slots__ = ("table", "board", "roadmap", "backlog", "graph", "resources", "filter", "sort", "group_by", "visible_fields", "column_widths", "collapsed_group_keys")
    TABLE_FIELD_NUMBER: _ClassVar[int]
    BOARD_FIELD_NUMBER: _ClassVar[int]
    ROADMAP_FIELD_NUMBER: _ClassVar[int]
    BACKLOG_FIELD_NUMBER: _ClassVar[int]
    GRAPH_FIELD_NUMBER: _ClassVar[int]
    RESOURCES_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_NUMBER: _ClassVar[int]
    GROUP_BY_FIELD_NUMBER: _ClassVar[int]
    VISIBLE_FIELDS_FIELD_NUMBER: _ClassVar[int]
    COLUMN_WIDTHS_FIELD_NUMBER: _ClassVar[int]
    COLLAPSED_GROUP_KEYS_FIELD_NUMBER: _ClassVar[int]
    table: TableLayout
    board: BoardLayout
    roadmap: RoadmapLayout
    backlog: BacklogLayout
    graph: GraphLayout
    resources: ResourcesLayout
    filter: TaskFilterGroup
    sort: _containers.RepeatedCompositeFieldContainer[TaskSort]
    group_by: TaskGroupBy
    visible_fields: _containers.RepeatedCompositeFieldContainer[TaskFieldRef]
    column_widths: _containers.RepeatedCompositeFieldContainer[ColumnWidth]
    collapsed_group_keys: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, table: _Optional[_Union[TableLayout, _Mapping]] = ..., board: _Optional[_Union[BoardLayout, _Mapping]] = ..., roadmap: _Optional[_Union[RoadmapLayout, _Mapping]] = ..., backlog: _Optional[_Union[BacklogLayout, _Mapping]] = ..., graph: _Optional[_Union[GraphLayout, _Mapping]] = ..., resources: _Optional[_Union[ResourcesLayout, _Mapping]] = ..., filter: _Optional[_Union[TaskFilterGroup, _Mapping]] = ..., sort: _Optional[_Iterable[_Union[TaskSort, _Mapping]]] = ..., group_by: _Optional[_Union[TaskGroupBy, _Mapping]] = ..., visible_fields: _Optional[_Iterable[_Union[TaskFieldRef, _Mapping]]] = ..., column_widths: _Optional[_Iterable[_Union[ColumnWidth, _Mapping]]] = ..., collapsed_group_keys: _Optional[_Iterable[str]] = ...) -> None: ...

class ViewConfig(_message.Message):
    __slots__ = ("id", "project_id", "name", "type", "created_at", "updated_at", "definition", "owner_id", "visibility", "sort_order")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DEFINITION_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    id: str
    project_id: str
    name: str
    type: ViewType
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    definition: ViewDefinition
    owner_id: str
    visibility: ViewVisibility
    sort_order: int
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., type: _Optional[_Union[ViewType, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., definition: _Optional[_Union[ViewDefinition, _Mapping]] = ..., owner_id: _Optional[str] = ..., visibility: _Optional[_Union[ViewVisibility, str]] = ..., sort_order: _Optional[int] = ...) -> None: ...

class TaskActivity(_message.Message):
    __slots__ = ("id", "task_id", "actor_id", "action", "timestamp", "field_id", "previous_value", "new_value")
    ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_VALUE_FIELD_NUMBER: _ClassVar[int]
    NEW_VALUE_FIELD_NUMBER: _ClassVar[int]
    id: str
    task_id: str
    actor_id: str
    action: ActivityAction
    timestamp: _timestamp_pb2.Timestamp
    field_id: str
    previous_value: str
    new_value: str
    def __init__(self, id: _Optional[str] = ..., task_id: _Optional[str] = ..., actor_id: _Optional[str] = ..., action: _Optional[_Union[ActivityAction, str]] = ..., timestamp: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., field_id: _Optional[str] = ..., previous_value: _Optional[str] = ..., new_value: _Optional[str] = ...) -> None: ...

class SelectOption(_message.Message):
    __slots__ = ("id", "label", "color", "sort_order")
    ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    id: str
    label: str
    color: str
    sort_order: int
    def __init__(self, id: _Optional[str] = ..., label: _Optional[str] = ..., color: _Optional[str] = ..., sort_order: _Optional[int] = ...) -> None: ...

class Sprint(_message.Message):
    __slots__ = ("id", "project_id", "organization_id", "name", "goal", "status", "start_date", "end_date", "sort_order", "task_count", "completed_task_count", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    GOAL_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    TASK_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_TASK_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    project_id: str
    organization_id: str
    name: str
    goal: str
    status: str
    start_date: str
    end_date: str
    sort_order: int
    task_count: int
    completed_task_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., goal: _Optional[str] = ..., status: _Optional[str] = ..., start_date: _Optional[str] = ..., end_date: _Optional[str] = ..., sort_order: _Optional[int] = ..., task_count: _Optional[int] = ..., completed_task_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateProjectRequest(_message.Message):
    __slots__ = ("organization_id", "name", "description", "icon", "color", "access_mode", "slug", "baseline_role", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    icon: str
    color: str
    access_mode: _common_pb2.AccessMode
    slug: str
    baseline_role: _common_pb2.ContentRole
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., slug: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetProjectRequest(_message.Message):
    __slots__ = ("organization_id", "project_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ...) -> None: ...

class UpdateProjectRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "name", "description", "icon", "color", "access_mode", "default_view_id", "slug", "type_field_schemas", "baseline_role", "tag_ids")
    class TypeFieldSchemasEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: TypeFieldSchema
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[TypeFieldSchema, _Mapping]] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_SCHEMAS_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    description: str
    icon: str
    color: str
    access_mode: _common_pb2.AccessMode
    default_view_id: str
    slug: str
    type_field_schemas: _containers.MessageMap[str, TypeFieldSchema]
    baseline_role: _common_pb2.ContentRole
    tag_ids: ProjectTagIds
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., default_view_id: _Optional[str] = ..., slug: _Optional[str] = ..., type_field_schemas: _Optional[_Mapping[str, TypeFieldSchema]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ..., tag_ids: _Optional[_Union[ProjectTagIds, _Mapping]] = ...) -> None: ...

class ProjectTagIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class DeleteProjectRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "permanent")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    permanent: bool
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., permanent: _Optional[bool] = ...) -> None: ...

class ListProjectsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "access_mode", "include_deleted")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    access_mode: _common_pb2.AccessMode
    include_deleted: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., include_deleted: _Optional[bool] = ...) -> None: ...

class CreateProjectResponse(_message.Message):
    __slots__ = ("project",)
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    project: Project
    def __init__(self, project: _Optional[_Union[Project, _Mapping]] = ...) -> None: ...

class GetProjectResponse(_message.Message):
    __slots__ = ("project",)
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    project: Project
    def __init__(self, project: _Optional[_Union[Project, _Mapping]] = ...) -> None: ...

class UpdateProjectResponse(_message.Message):
    __slots__ = ("project",)
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    project: Project
    def __init__(self, project: _Optional[_Union[Project, _Mapping]] = ...) -> None: ...

class DeleteProjectResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class ListProjectsResponse(_message.Message):
    __slots__ = ("projects", "pagination")
    PROJECTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    projects: _containers.RepeatedCompositeFieldContainer[Project]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, projects: _Optional[_Iterable[_Union[Project, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class CreateTaskRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "field_values", "task_type", "sprint_id", "estimated_minutes", "time_spent_minutes", "tag_ids")
    class FieldValuesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_IDS_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    DUE_DATE_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_BY_TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_MILESTONE_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_RULE_FIELD_NUMBER: _ClassVar[int]
    FIELD_VALUES_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TIME_SPENT_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    title: str
    description: str
    status: str
    priority: str
    assignee_ids: _containers.RepeatedScalarFieldContainer[str]
    start_date: str
    due_date: str
    parent_id: str
    blocked_by_task_ids: _containers.RepeatedScalarFieldContainer[str]
    is_milestone: bool
    recurrence_rule: str
    field_values: _containers.ScalarMap[str, str]
    task_type: str
    sprint_id: str
    estimated_minutes: int
    time_spent_minutes: int
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., field_values: _Optional[_Mapping[str, str]] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ..., estimated_minutes: _Optional[int] = ..., time_spent_minutes: _Optional[int] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class UpdateTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "sort_order", "field_values", "task_type", "sprint_id", "estimated_minutes", "time_spent_minutes", "tag_ids")
    class FieldValuesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_IDS_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    DUE_DATE_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_BY_TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_MILESTONE_FIELD_NUMBER: _ClassVar[int]
    RECURRENCE_RULE_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    FIELD_VALUES_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TIME_SPENT_MINUTES_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    title: str
    description: str
    status: str
    priority: str
    assignee_ids: TaskAssigneeIds
    start_date: str
    due_date: str
    parent_id: str
    blocked_by_task_ids: _containers.RepeatedScalarFieldContainer[str]
    is_milestone: bool
    recurrence_rule: str
    sort_order: int
    field_values: _containers.ScalarMap[str, str]
    task_type: str
    sprint_id: str
    estimated_minutes: int
    time_spent_minutes: int
    tag_ids: TaskTagIds
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Union[TaskAssigneeIds, _Mapping]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., sort_order: _Optional[int] = ..., field_values: _Optional[_Mapping[str, str]] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ..., estimated_minutes: _Optional[int] = ..., time_spent_minutes: _Optional[int] = ..., tag_ids: _Optional[_Union[TaskTagIds, _Mapping]] = ...) -> None: ...

class TaskTagIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class TaskAssigneeIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class MoveTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "status", "sort_order")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    status: str
    sort_order: int
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., status: _Optional[str] = ..., sort_order: _Optional[int] = ...) -> None: ...

class BulkUpdateTasksRequest(_message.Message):
    __slots__ = ("organization_id", "task_ids", "status", "priority", "assignee_ids", "sprint_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_IDS_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_ids: _containers.RepeatedScalarFieldContainer[str]
    status: str
    priority: str
    assignee_ids: _containers.RepeatedScalarFieldContainer[str]
    sprint_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_ids: _Optional[_Iterable[str]] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., sprint_id: _Optional[str] = ...) -> None: ...

class DeleteTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "permanent")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    permanent: bool
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., permanent: _Optional[bool] = ...) -> None: ...

class DeleteTasksRequest(_message.Message):
    __slots__ = ("organization_id", "task_ids", "permanent")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    PERMANENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_ids: _containers.RepeatedScalarFieldContainer[str]
    permanent: bool
    def __init__(self, organization_id: _Optional[str] = ..., task_ids: _Optional[_Iterable[str]] = ..., permanent: _Optional[bool] = ...) -> None: ...

class ListTasksRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "pagination", "include_deleted", "parent_id", "filter", "sort", "time_zone")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_NUMBER: _ClassVar[int]
    TIME_ZONE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    pagination: _common_pb2.PaginationRequest
    include_deleted: bool
    parent_id: str
    filter: TaskFilterGroup
    sort: _containers.RepeatedCompositeFieldContainer[TaskSort]
    time_zone: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., include_deleted: _Optional[bool] = ..., parent_id: _Optional[str] = ..., filter: _Optional[_Union[TaskFilterGroup, _Mapping]] = ..., sort: _Optional[_Iterable[_Union[TaskSort, _Mapping]]] = ..., time_zone: _Optional[str] = ...) -> None: ...

class CreateTaskResponse(_message.Message):
    __slots__ = ("task", "updated_parent", "spawned_task")
    TASK_FIELD_NUMBER: _ClassVar[int]
    UPDATED_PARENT_FIELD_NUMBER: _ClassVar[int]
    SPAWNED_TASK_FIELD_NUMBER: _ClassVar[int]
    task: Task
    updated_parent: Task
    spawned_task: Task
    def __init__(self, task: _Optional[_Union[Task, _Mapping]] = ..., updated_parent: _Optional[_Union[Task, _Mapping]] = ..., spawned_task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

class GetTaskResponse(_message.Message):
    __slots__ = ("task", "updated_parent", "spawned_task")
    TASK_FIELD_NUMBER: _ClassVar[int]
    UPDATED_PARENT_FIELD_NUMBER: _ClassVar[int]
    SPAWNED_TASK_FIELD_NUMBER: _ClassVar[int]
    task: Task
    updated_parent: Task
    spawned_task: Task
    def __init__(self, task: _Optional[_Union[Task, _Mapping]] = ..., updated_parent: _Optional[_Union[Task, _Mapping]] = ..., spawned_task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

class UpdateTaskResponse(_message.Message):
    __slots__ = ("task", "updated_parent", "spawned_task")
    TASK_FIELD_NUMBER: _ClassVar[int]
    UPDATED_PARENT_FIELD_NUMBER: _ClassVar[int]
    SPAWNED_TASK_FIELD_NUMBER: _ClassVar[int]
    task: Task
    updated_parent: Task
    spawned_task: Task
    def __init__(self, task: _Optional[_Union[Task, _Mapping]] = ..., updated_parent: _Optional[_Union[Task, _Mapping]] = ..., spawned_task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

class MoveTaskResponse(_message.Message):
    __slots__ = ("task", "updated_parent", "spawned_task")
    TASK_FIELD_NUMBER: _ClassVar[int]
    UPDATED_PARENT_FIELD_NUMBER: _ClassVar[int]
    SPAWNED_TASK_FIELD_NUMBER: _ClassVar[int]
    task: Task
    updated_parent: Task
    spawned_task: Task
    def __init__(self, task: _Optional[_Union[Task, _Mapping]] = ..., updated_parent: _Optional[_Union[Task, _Mapping]] = ..., spawned_task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

class DeleteTaskResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class DeleteTasksResponse(_message.Message):
    __slots__ = ("success", "deleted_count")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    DELETED_COUNT_FIELD_NUMBER: _ClassVar[int]
    success: bool
    deleted_count: int
    def __init__(self, success: _Optional[bool] = ..., deleted_count: _Optional[int] = ...) -> None: ...

class BulkUpdateTasksResponse(_message.Message):
    __slots__ = ("tasks", "updated_count")
    TASKS_FIELD_NUMBER: _ClassVar[int]
    UPDATED_COUNT_FIELD_NUMBER: _ClassVar[int]
    tasks: _containers.RepeatedCompositeFieldContainer[Task]
    updated_count: int
    def __init__(self, tasks: _Optional[_Iterable[_Union[Task, _Mapping]]] = ..., updated_count: _Optional[int] = ...) -> None: ...

class ListTasksResponse(_message.Message):
    __slots__ = ("tasks", "pagination")
    TASKS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    tasks: _containers.RepeatedCompositeFieldContainer[Task]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, tasks: _Optional[_Iterable[_Union[Task, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class CreateFieldRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "name", "type", "is_required", "sort_order", "config_json")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    type: FieldType
    is_required: bool
    sort_order: int
    config_json: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., type: _Optional[_Union[FieldType, str]] = ..., is_required: _Optional[bool] = ..., sort_order: _Optional[int] = ..., config_json: _Optional[str] = ...) -> None: ...

class UpdateFieldRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "field_id", "name", "is_required", "sort_order", "config_json")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    SORT_ORDER_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    field_id: str
    name: str
    is_required: bool
    sort_order: int
    config_json: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., field_id: _Optional[str] = ..., name: _Optional[str] = ..., is_required: _Optional[bool] = ..., sort_order: _Optional[int] = ..., config_json: _Optional[str] = ...) -> None: ...

class DeleteFieldRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "field_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    FIELD_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    field_id: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., field_id: _Optional[str] = ...) -> None: ...

class CreateFieldResponse(_message.Message):
    __slots__ = ("field",)
    FIELD_FIELD_NUMBER: _ClassVar[int]
    field: FieldDefinition
    def __init__(self, field: _Optional[_Union[FieldDefinition, _Mapping]] = ...) -> None: ...

class UpdateFieldResponse(_message.Message):
    __slots__ = ("field",)
    FIELD_FIELD_NUMBER: _ClassVar[int]
    field: FieldDefinition
    def __init__(self, field: _Optional[_Union[FieldDefinition, _Mapping]] = ...) -> None: ...

class DeleteFieldResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class CreateViewRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "name", "definition", "visibility")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DEFINITION_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    definition: ViewDefinition
    visibility: ViewVisibility
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., definition: _Optional[_Union[ViewDefinition, _Mapping]] = ..., visibility: _Optional[_Union[ViewVisibility, str]] = ...) -> None: ...

class UpdateViewRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "view_id", "name", "definition", "visibility")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DEFINITION_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    view_id: str
    name: str
    definition: ViewDefinition
    visibility: ViewVisibility
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., view_id: _Optional[str] = ..., name: _Optional[str] = ..., definition: _Optional[_Union[ViewDefinition, _Mapping]] = ..., visibility: _Optional[_Union[ViewVisibility, str]] = ...) -> None: ...

class DeleteViewRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "view_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    view_id: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., view_id: _Optional[str] = ...) -> None: ...

class CreateViewResponse(_message.Message):
    __slots__ = ("view",)
    VIEW_FIELD_NUMBER: _ClassVar[int]
    view: ViewConfig
    def __init__(self, view: _Optional[_Union[ViewConfig, _Mapping]] = ...) -> None: ...

class UpdateViewResponse(_message.Message):
    __slots__ = ("view",)
    VIEW_FIELD_NUMBER: _ClassVar[int]
    view: ViewConfig
    def __init__(self, view: _Optional[_Union[ViewConfig, _Mapping]] = ...) -> None: ...

class DeleteViewResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ReorderViewsRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "visibility", "view_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    VIEW_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    visibility: ViewVisibility
    view_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., visibility: _Optional[_Union[ViewVisibility, str]] = ..., view_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ReorderViewsResponse(_message.Message):
    __slots__ = ("views",)
    VIEWS_FIELD_NUMBER: _ClassVar[int]
    views: _containers.RepeatedCompositeFieldContainer[ViewConfig]
    def __init__(self, views: _Optional[_Iterable[_Union[ViewConfig, _Mapping]]] = ...) -> None: ...

class CreateSprintRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "name", "goal", "start_date", "end_date")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    GOAL_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    goal: str
    start_date: str
    end_date: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., goal: _Optional[str] = ..., start_date: _Optional[str] = ..., end_date: _Optional[str] = ...) -> None: ...

class UpdateSprintRequest(_message.Message):
    __slots__ = ("organization_id", "sprint_id", "name", "goal", "start_date", "end_date")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    GOAL_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    sprint_id: str
    name: str
    goal: str
    start_date: str
    end_date: str
    def __init__(self, organization_id: _Optional[str] = ..., sprint_id: _Optional[str] = ..., name: _Optional[str] = ..., goal: _Optional[str] = ..., start_date: _Optional[str] = ..., end_date: _Optional[str] = ...) -> None: ...

class StartSprintRequest(_message.Message):
    __slots__ = ("organization_id", "sprint_id", "start_date", "end_date")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    sprint_id: str
    start_date: str
    end_date: str
    def __init__(self, organization_id: _Optional[str] = ..., sprint_id: _Optional[str] = ..., start_date: _Optional[str] = ..., end_date: _Optional[str] = ...) -> None: ...

class CompleteSprintRequest(_message.Message):
    __slots__ = ("organization_id", "sprint_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    sprint_id: str
    def __init__(self, organization_id: _Optional[str] = ..., sprint_id: _Optional[str] = ...) -> None: ...

class DeleteSprintRequest(_message.Message):
    __slots__ = ("organization_id", "sprint_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    sprint_id: str
    def __init__(self, organization_id: _Optional[str] = ..., sprint_id: _Optional[str] = ...) -> None: ...

class ListSprintsRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "include_closed")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_CLOSED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    include_closed: bool
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., include_closed: _Optional[bool] = ...) -> None: ...

class CreateSprintResponse(_message.Message):
    __slots__ = ("sprint",)
    SPRINT_FIELD_NUMBER: _ClassVar[int]
    sprint: Sprint
    def __init__(self, sprint: _Optional[_Union[Sprint, _Mapping]] = ...) -> None: ...

class UpdateSprintResponse(_message.Message):
    __slots__ = ("sprint",)
    SPRINT_FIELD_NUMBER: _ClassVar[int]
    sprint: Sprint
    def __init__(self, sprint: _Optional[_Union[Sprint, _Mapping]] = ...) -> None: ...

class StartSprintResponse(_message.Message):
    __slots__ = ("sprint",)
    SPRINT_FIELD_NUMBER: _ClassVar[int]
    sprint: Sprint
    def __init__(self, sprint: _Optional[_Union[Sprint, _Mapping]] = ...) -> None: ...

class CompleteSprintResponse(_message.Message):
    __slots__ = ("sprint",)
    SPRINT_FIELD_NUMBER: _ClassVar[int]
    sprint: Sprint
    def __init__(self, sprint: _Optional[_Union[Sprint, _Mapping]] = ...) -> None: ...

class DeleteSprintResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListSprintsResponse(_message.Message):
    __slots__ = ("sprints",)
    SPRINTS_FIELD_NUMBER: _ClassVar[int]
    sprints: _containers.RepeatedCompositeFieldContainer[Sprint]
    def __init__(self, sprints: _Optional[_Iterable[_Union[Sprint, _Mapping]]] = ...) -> None: ...

class ListActivitiesRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListActivitiesResponse(_message.Message):
    __slots__ = ("activities", "pagination")
    ACTIVITIES_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    activities: _containers.RepeatedCompositeFieldContainer[TaskActivity]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, activities: _Optional[_Iterable[_Union[TaskActivity, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class ToggleTaskWatcherRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class ToggleTaskWatcherResponse(_message.Message):
    __slots__ = ("is_watching",)
    IS_WATCHING_FIELD_NUMBER: _ClassVar[int]
    is_watching: bool
    def __init__(self, is_watching: _Optional[bool] = ...) -> None: ...

class ListTaskWatchersRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class ListTaskWatchersResponse(_message.Message):
    __slots__ = ("watcher_user_ids", "watcher_count")
    WATCHER_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    WATCHER_COUNT_FIELD_NUMBER: _ClassVar[int]
    watcher_user_ids: _containers.RepeatedScalarFieldContainer[str]
    watcher_count: int
    def __init__(self, watcher_user_ids: _Optional[_Iterable[str]] = ..., watcher_count: _Optional[int] = ...) -> None: ...

class BulkCheckTaskWatchersRequest(_message.Message):
    __slots__ = ("organization_id", "task_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., task_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class BulkCheckTaskWatchersResponse(_message.Message):
    __slots__ = ("watched_tasks",)
    class WatchedTasksEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: bool
        def __init__(self, key: _Optional[str] = ..., value: _Optional[bool] = ...) -> None: ...
    WATCHED_TASKS_FIELD_NUMBER: _ClassVar[int]
    watched_tasks: _containers.ScalarMap[str, bool]
    def __init__(self, watched_tasks: _Optional[_Mapping[str, bool]] = ...) -> None: ...
