"""
Projects proto converters.

Provides bidirectional mapping between domain models and projects.v1 proto types.
"""

import json

from uniffy.core.converters.common_proto import visibility_to_proto
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.gen.projects.v1.projects_pb2 import (
    ActivityAction,
    FieldType,
    ViewType,
)
from uniffy.gen.projects.v1.projects_pb2 import (
    FieldDefinition as ProtoFieldDefinition,
)
from uniffy.gen.projects.v1.projects_pb2 import (
    Project as ProtoProject,
)
from uniffy.gen.projects.v1.projects_pb2 import (
    Task as ProtoTask,
)
from uniffy.gen.projects.v1.projects_pb2 import (
    TaskActivity as ProtoTaskActivity,
)
from uniffy.gen.projects.v1.projects_pb2 import (
    ViewConfig as ProtoViewConfig,
)

# =============================================================================
# ENUM MAPPINGS - Domain <-> Proto
# =============================================================================

# FieldType mappings
FIELD_TYPE_TO_PROTO: dict[str, FieldType.ValueType] = {
    "text": FieldType.FIELD_TYPE_TEXT,
    "number": FieldType.FIELD_TYPE_NUMBER,
    "single_select": FieldType.FIELD_TYPE_SINGLE_SELECT,
    "multi_select": FieldType.FIELD_TYPE_MULTI_SELECT,
    "date": FieldType.FIELD_TYPE_DATE,
    "person": FieldType.FIELD_TYPE_PERSON,
    "reference": FieldType.FIELD_TYPE_REFERENCE,
}

FIELD_TYPE_FROM_PROTO: dict[FieldType.ValueType, str] = {
    v: k for k, v in FIELD_TYPE_TO_PROTO.items()
}

# ViewType mappings
VIEW_TYPE_TO_PROTO: dict[str, ViewType.ValueType] = {
    "table": ViewType.VIEW_TYPE_TABLE,
    "board": ViewType.VIEW_TYPE_BOARD,
    "roadmap": ViewType.VIEW_TYPE_ROADMAP,
}

VIEW_TYPE_FROM_PROTO: dict[ViewType.ValueType, str] = {
    v: k for k, v in VIEW_TYPE_TO_PROTO.items()
}

# ActivityAction mappings
ACTIVITY_ACTION_TO_PROTO: dict[str, ActivityAction.ValueType] = {
    "created": ActivityAction.ACTIVITY_ACTION_CREATED,
    "status_changed": ActivityAction.ACTIVITY_ACTION_STATUS_CHANGED,
    "priority_changed": ActivityAction.ACTIVITY_ACTION_PRIORITY_CHANGED,
    "field_updated": ActivityAction.ACTIVITY_ACTION_FIELD_UPDATED,
    "blocked_by_added": ActivityAction.ACTIVITY_ACTION_BLOCKED_BY_ADDED,
    "blocked_by_removed": ActivityAction.ACTIVITY_ACTION_BLOCKED_BY_REMOVED,
    "assigned": ActivityAction.ACTIVITY_ACTION_ASSIGNED,
}

# =============================================================================
# ENUM CONVERTER FUNCTIONS
# =============================================================================


def field_type_to_proto(field_type: str) -> FieldType.ValueType:
    """Convert domain field type string to proto FieldType."""
    return FIELD_TYPE_TO_PROTO.get(field_type, FieldType.FIELD_TYPE_UNSPECIFIED)


def field_type_from_proto(proto_type: FieldType.ValueType) -> str:
    """Convert proto FieldType to domain string."""
    return FIELD_TYPE_FROM_PROTO.get(proto_type, "text")


def view_type_to_proto(view_type: str) -> ViewType.ValueType:
    """Convert domain view type string to proto ViewType."""
    return VIEW_TYPE_TO_PROTO.get(view_type, ViewType.VIEW_TYPE_UNSPECIFIED)


def view_type_from_proto(proto_type: ViewType.ValueType) -> str:
    """Convert proto ViewType to domain string."""
    return VIEW_TYPE_FROM_PROTO.get(proto_type, "table")


def activity_action_to_proto(action: str) -> ActivityAction.ValueType:
    """Convert domain action string to proto ActivityAction."""
    return ACTIVITY_ACTION_TO_PROTO.get(action, ActivityAction.ACTIVITY_ACTION_UNSPECIFIED)


# =============================================================================
# MODEL -> PROTO CONVERTERS
# =============================================================================


def project_to_proto(
    project: Project,
    fields: list[FieldDefinition],
    views: list[ViewConfig],
) -> ProtoProject:
    """
    Convert Project model to proto Project message.

    Parameters
    ----------
    project : Project
        Project model instance.
    fields : list[FieldDefinition]
        Field definitions for this project.
    views : list[ViewConfig]
        View configurations for this project.

    Returns
    -------
    ProtoProject
        Proto project message.

    """
    proto = ProtoProject(
        id=str(project.id),
        organization_id=str(project.organization_id),
        owner_id=str(project.owner_id),
        name=project.name,
        description=project.description,
        icon=project.icon,
        color=project.color,
        visibility=visibility_to_proto(project.visibility),
        field_definitions=[field_to_proto(f) for f in fields],
        views=[view_to_proto(v) for v in views],
        default_view_id=project.default_view_id or "",
        member_ids=project.member_ids or [],
        created_at=datetime_to_timestamp(project.created_at),
        updated_at=datetime_to_timestamp(project.updated_at),
        urn=project.urn,
    )

    if project.deleted_at:
        proto.deleted_at.CopyFrom(datetime_to_timestamp(project.deleted_at))

    return proto


def task_to_proto(task: Task) -> ProtoTask:
    """
    Convert Task model to proto Task message.

    Parameters
    ----------
    task : Task
        Task model instance.

    Returns
    -------
    ProtoTask
        Proto task message.

    """
    # Convert field_values dict to map<string, string>
    # Complex values (arrays) are JSON-encoded
    field_values_map = {}
    if task.field_values:
        for key, value in task.field_values.items():
            if isinstance(value, (list, dict)):
                field_values_map[key] = json.dumps(value)
            else:
                field_values_map[key] = str(value) if value is not None else ""

    proto = ProtoTask(
        id=str(task.id),
        project_id=str(task.project_id),
        organization_id=str(task.organization_id),
        owner_id=str(task.owner_id),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assignee_ids=task.assignee_ids or [],
        is_milestone=task.is_milestone,
        sort_order=task.sort_order,
        field_values=field_values_map,
        outgoing_references=task.outgoing_references or [],
        created_at=datetime_to_timestamp(task.created_at),
        updated_at=datetime_to_timestamp(task.updated_at),
        urn=task.urn,
    )

    # Optional fields
    if task.start_date:
        proto.start_date = task.start_date
    if task.due_date:
        proto.due_date = task.due_date
    if task.completed_at:
        proto.completed_at.CopyFrom(datetime_to_timestamp(task.completed_at))
    if task.parent_id:
        proto.parent_id = str(task.parent_id)
    if task.blocked_by_task_ids:
        proto.blocked_by_task_ids.extend(task.blocked_by_task_ids)
    if task.recurrence_rule:
        proto.recurrence_rule = task.recurrence_rule
    if task.deleted_at:
        proto.deleted_at.CopyFrom(datetime_to_timestamp(task.deleted_at))

    return proto


def field_to_proto(field: FieldDefinition) -> ProtoFieldDefinition:
    """
    Convert FieldDefinition model to proto FieldDefinition message.

    Parameters
    ----------
    field : FieldDefinition
        Field definition model instance.

    Returns
    -------
    ProtoFieldDefinition
        Proto field definition message.

    """
    # Convert config dict to JSON string
    config_json = json.dumps(field.config) if field.config else "{}"

    return ProtoFieldDefinition(
        id=field.id,
        project_id=str(field.project_id),
        name=field.name,
        type=field_type_to_proto(field.type),
        is_required=field.is_required,
        is_system=field.is_system,
        sort_order=field.sort_order,
        config_json=config_json,
        created_at=datetime_to_timestamp(field.created_at),
        updated_at=datetime_to_timestamp(field.updated_at),
    )


def view_to_proto(view: ViewConfig) -> ProtoViewConfig:
    """
    Convert ViewConfig model to proto ViewConfig message.

    Parameters
    ----------
    view : ViewConfig
        View configuration model instance.

    Returns
    -------
    ProtoViewConfig
        Proto view config message.

    """
    # Convert config dict to JSON string
    config_json = json.dumps(view.config) if view.config else "{}"

    return ProtoViewConfig(
        id=view.id,
        project_id=str(view.project_id),
        name=view.name,
        type=view_type_to_proto(view.type),
        is_default=view.is_default,
        config_json=config_json,
        created_at=datetime_to_timestamp(view.created_at),
        updated_at=datetime_to_timestamp(view.updated_at),
    )


def activity_to_proto(activity: TaskActivity) -> ProtoTaskActivity:
    """
    Convert TaskActivity model to proto TaskActivity message.

    Parameters
    ----------
    activity : TaskActivity
        Task activity model instance.

    Returns
    -------
    ProtoTaskActivity
        Proto task activity message.

    """
    proto = ProtoTaskActivity(
        id=str(activity.id),
        task_id=str(activity.task_id),
        actor_id=str(activity.actor_id),
        action=activity_action_to_proto(activity.action),
        timestamp=datetime_to_timestamp(activity.timestamp),
    )

    # Optional fields
    if activity.field_id:
        proto.field_id = activity.field_id
    if activity.previous_value:
        proto.previous_value = activity.previous_value
    if activity.new_value:
        proto.new_value = activity.new_value
    return proto
