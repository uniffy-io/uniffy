import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
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
    __slots__ = ("id", "organization_id", "owner_id", "name", "description", "icon", "color", "visibility", "field_definitions", "views", "default_view_id", "member_ids", "created_at", "updated_at", "deleted_at", "urn", "user_permission_level", "slug")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    FIELD_DEFINITIONS_FIELD_NUMBER: _ClassVar[int]
    VIEWS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    MEMBER_IDS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    USER_PERMISSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    name: str
    description: str
    icon: str
    color: str
    visibility: _common_pb2.VisibilityScope
    field_definitions: _containers.RepeatedCompositeFieldContainer[FieldDefinition]
    views: _containers.RepeatedCompositeFieldContainer[ViewConfig]
    default_view_id: str
    member_ids: _containers.RepeatedScalarFieldContainer[str]
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    deleted_at: _timestamp_pb2.Timestamp
    urn: str
    user_permission_level: _common_pb2.PermissionLevel
    slug: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., visibility: _Optional[_Union[_common_pb2.VisibilityScope, str]] = ..., field_definitions: _Optional[_Iterable[_Union[FieldDefinition, _Mapping]]] = ..., views: _Optional[_Iterable[_Union[ViewConfig, _Mapping]]] = ..., default_view_id: _Optional[str] = ..., member_ids: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., urn: _Optional[str] = ..., user_permission_level: _Optional[_Union[_common_pb2.PermissionLevel, str]] = ..., slug: _Optional[str] = ...) -> None: ...

class Task(_message.Message):
    __slots__ = ("id", "project_id", "organization_id", "owner_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "completed_at", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "sort_order", "field_values", "outgoing_references", "created_at", "updated_at", "deleted_at", "urn", "number", "task_type", "sprint_id", "user_permission_level", "subtask_total", "subtask_completed")
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
    USER_PERMISSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_TOTAL_FIELD_NUMBER: _ClassVar[int]
    SUBTASK_COMPLETED_FIELD_NUMBER: _ClassVar[int]
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
    user_permission_level: _common_pb2.PermissionLevel
    subtask_total: int
    subtask_completed: int
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., sort_order: _Optional[int] = ..., field_values: _Optional[_Mapping[str, str]] = ..., outgoing_references: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., urn: _Optional[str] = ..., number: _Optional[int] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ..., user_permission_level: _Optional[_Union[_common_pb2.PermissionLevel, str]] = ..., subtask_total: _Optional[int] = ..., subtask_completed: _Optional[int] = ...) -> None: ...

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

class ViewConfig(_message.Message):
    __slots__ = ("id", "project_id", "name", "type", "is_default", "config_json", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    project_id: str
    name: str
    type: ViewType
    is_default: bool
    config_json: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., type: _Optional[_Union[ViewType, str]] = ..., is_default: _Optional[bool] = ..., config_json: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
    __slots__ = ("organization_id", "name", "description", "icon", "color", "visibility", "slug")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    icon: str
    color: str
    visibility: _common_pb2.VisibilityScope
    slug: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., visibility: _Optional[_Union[_common_pb2.VisibilityScope, str]] = ..., slug: _Optional[str] = ...) -> None: ...

class GetProjectRequest(_message.Message):
    __slots__ = ("organization_id", "project_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ...) -> None: ...

class UpdateProjectRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "name", "description", "icon", "color", "visibility", "member_ids", "default_view_id", "slug")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    COLOR_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    MEMBER_IDS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    description: str
    icon: str
    color: str
    visibility: _common_pb2.VisibilityScope
    member_ids: _containers.RepeatedScalarFieldContainer[str]
    default_view_id: str
    slug: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., color: _Optional[str] = ..., visibility: _Optional[_Union[_common_pb2.VisibilityScope, str]] = ..., member_ids: _Optional[_Iterable[str]] = ..., default_view_id: _Optional[str] = ..., slug: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "pagination", "visibility", "include_deleted")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    visibility: _common_pb2.VisibilityScope
    include_deleted: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., visibility: _Optional[_Union[_common_pb2.VisibilityScope, str]] = ..., include_deleted: _Optional[bool] = ...) -> None: ...

class ProjectResponse(_message.Message):
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
    __slots__ = ("organization_id", "project_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "field_values", "task_type", "sprint_id")
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
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., field_values: _Optional[_Mapping[str, str]] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ...) -> None: ...

class GetTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class UpdateTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "title", "description", "status", "priority", "assignee_ids", "start_date", "due_date", "parent_id", "blocked_by_task_ids", "is_milestone", "recurrence_rule", "sort_order", "field_values", "task_type", "sprint_id")
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
    organization_id: str
    task_id: str
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
    sort_order: int
    field_values: _containers.ScalarMap[str, str]
    task_type: str
    sprint_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ..., status: _Optional[str] = ..., priority: _Optional[str] = ..., assignee_ids: _Optional[_Iterable[str]] = ..., start_date: _Optional[str] = ..., due_date: _Optional[str] = ..., parent_id: _Optional[str] = ..., blocked_by_task_ids: _Optional[_Iterable[str]] = ..., is_milestone: _Optional[bool] = ..., recurrence_rule: _Optional[str] = ..., sort_order: _Optional[int] = ..., field_values: _Optional[_Mapping[str, str]] = ..., task_type: _Optional[str] = ..., sprint_id: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "project_id", "pagination", "include_deleted", "parent_id", "sprint_id", "backlog_only")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    PARENT_ID_FIELD_NUMBER: _ClassVar[int]
    SPRINT_ID_FIELD_NUMBER: _ClassVar[int]
    BACKLOG_ONLY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    pagination: _common_pb2.PaginationRequest
    include_deleted: bool
    parent_id: str
    sprint_id: str
    backlog_only: bool
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., include_deleted: _Optional[bool] = ..., parent_id: _Optional[str] = ..., sprint_id: _Optional[str] = ..., backlog_only: _Optional[bool] = ...) -> None: ...

class TaskResponse(_message.Message):
    __slots__ = ("task",)
    TASK_FIELD_NUMBER: _ClassVar[int]
    task: Task
    def __init__(self, task: _Optional[_Union[Task, _Mapping]] = ...) -> None: ...

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

class FieldResponse(_message.Message):
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
    __slots__ = ("organization_id", "project_id", "name", "type", "is_default", "config_json")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    name: str
    type: ViewType
    is_default: bool
    config_json: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., name: _Optional[str] = ..., type: _Optional[_Union[ViewType, str]] = ..., is_default: _Optional[bool] = ..., config_json: _Optional[str] = ...) -> None: ...

class UpdateViewRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "view_id", "name", "is_default", "config_json")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    view_id: str
    name: str
    is_default: bool
    config_json: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., view_id: _Optional[str] = ..., name: _Optional[str] = ..., is_default: _Optional[bool] = ..., config_json: _Optional[str] = ...) -> None: ...

class DeleteViewRequest(_message.Message):
    __slots__ = ("organization_id", "project_id", "view_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    VIEW_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    project_id: str
    view_id: str
    def __init__(self, organization_id: _Optional[str] = ..., project_id: _Optional[str] = ..., view_id: _Optional[str] = ...) -> None: ...

class ViewResponse(_message.Message):
    __slots__ = ("view",)
    VIEW_FIELD_NUMBER: _ClassVar[int]
    view: ViewConfig
    def __init__(self, view: _Optional[_Union[ViewConfig, _Mapping]] = ...) -> None: ...

class DeleteViewResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

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

class SprintResponse(_message.Message):
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
