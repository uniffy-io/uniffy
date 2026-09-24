"""Projects proto converters."""

from uniffy_proto.projects.v1.projects_pb2 import (
    ActivityAction,
    FieldType,
    ViewType,
    ViewVisibility,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    FieldDefinition as ProtoFieldDefinition,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    Project as ProtoProject,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    Sprint as ProtoSprint,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    Task as ProtoTask,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    TaskActivity as ProtoTaskActivity,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    TypeFieldSchema as ProtoTypeFieldSchema,
)
from uniffy_proto.projects.v1.projects_pb2 import (
    ViewConfig as ProtoViewConfig,
)

from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import (
    ProjectViewType,
    ProjectViewVisibility,
    ViewConfig,
)
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.views.definition import definition_from_dict
from uniffy.domains.tags.converters import tag_to_proto

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

VIEW_TYPE_TO_PROTO: dict[str, ViewType.ValueType] = {
    ProjectViewType.TABLE: ViewType.VIEW_TYPE_TABLE,
    ProjectViewType.BOARD: ViewType.VIEW_TYPE_BOARD,
    ProjectViewType.ROADMAP: ViewType.VIEW_TYPE_ROADMAP,
    ProjectViewType.BACKLOG: ViewType.VIEW_TYPE_BACKLOG,
    ProjectViewType.GRAPH: ViewType.VIEW_TYPE_GRAPH,
    ProjectViewType.RESOURCES: ViewType.VIEW_TYPE_RESOURCES,
}

VIEW_VISIBILITY_TO_PROTO: dict[str, ViewVisibility.ValueType] = {
    ProjectViewVisibility.PERSONAL: ViewVisibility.VIEW_VISIBILITY_PERSONAL,
    ProjectViewVisibility.SHARED: ViewVisibility.VIEW_VISIBILITY_SHARED,
}

VIEW_VISIBILITY_FROM_PROTO: dict[ViewVisibility.ValueType, ProjectViewVisibility] = {
    ViewVisibility.VIEW_VISIBILITY_PERSONAL: ProjectViewVisibility.PERSONAL,
    ViewVisibility.VIEW_VISIBILITY_SHARED: ProjectViewVisibility.SHARED,
}

ACTIVITY_ACTION_TO_PROTO: dict[str, ActivityAction.ValueType] = {
    "created": ActivityAction.ACTIVITY_ACTION_CREATED,
    "status_changed": ActivityAction.ACTIVITY_ACTION_STATUS_CHANGED,
    "priority_changed": ActivityAction.ACTIVITY_ACTION_PRIORITY_CHANGED,
    "field_updated": ActivityAction.ACTIVITY_ACTION_FIELD_UPDATED,
    "blocked_by_added": ActivityAction.ACTIVITY_ACTION_BLOCKED_BY_ADDED,
    "blocked_by_removed": ActivityAction.ACTIVITY_ACTION_BLOCKED_BY_REMOVED,
    "assigned": ActivityAction.ACTIVITY_ACTION_ASSIGNED,
    "type_changed": ActivityAction.ACTIVITY_ACTION_TYPE_CHANGED,
    "sprint_changed": ActivityAction.ACTIVITY_ACTION_SPRINT_CHANGED,
}


def field_type_to_proto(field_type: str) -> FieldType.ValueType:
    return FIELD_TYPE_TO_PROTO.get(field_type, FieldType.FIELD_TYPE_UNSPECIFIED)


def field_type_from_proto(proto_type: FieldType.ValueType) -> str:
    return FIELD_TYPE_FROM_PROTO.get(proto_type, "text")


def view_type_to_proto(view_type: str) -> ViewType.ValueType:
    return VIEW_TYPE_TO_PROTO.get(view_type, ViewType.VIEW_TYPE_UNSPECIFIED)


def view_visibility_from_proto(visibility: ViewVisibility.ValueType) -> ProjectViewVisibility:
    resolved = VIEW_VISIBILITY_FROM_PROTO.get(visibility)
    if resolved is None:
        raise ValidationError("visibility", "A view must be personal or shared")
    return resolved


def activity_action_to_proto(action: str) -> ActivityAction.ValueType:
    return ACTIVITY_ACTION_TO_PROTO.get(action, ActivityAction.ACTIVITY_ACTION_UNSPECIFIED)


def project_to_proto(
    project: Project,
    fields: list[FieldDefinition],
    views: list[ViewConfig],
    user_role: ContentRole | None = None,
    tags: list[Tag] | None = None,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
    task_count: int = 0,
    completed_task_count: int = 0,
    member_count: int = 0,
    overdue_task_count: int = 0,
    estimated_minutes: int = 0,
    time_spent_minutes: int = 0,
) -> ProtoProject:
    type_schemas_proto: dict[str, ProtoTypeFieldSchema] = {}
    if project.type_field_schemas:
        for type_name, schema in project.type_field_schemas.items():
            type_schemas_proto[type_name] = ProtoTypeFieldSchema(
                shown_field_ids=schema.get("shown_field_ids", []),
                required_field_ids=schema.get("required_field_ids", []),
            )

    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else project.access_mode
    )
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else project.baseline_role
    )
    proto = ProtoProject(
        id=str(project.id),
        organization_id=str(project.organization_id),
        owner_id=str(project.owner_id),
        name=project.name,
        description=project.description,
        icon=project.icon,
        color=project.color,
        slug=project.slug,
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        field_definitions=[field_to_proto(f) for f in fields],
        views=[view_to_proto(v) for v in views],
        default_view_id=project.default_view_id or "",
        created_at=datetime_to_timestamp(project.created_at),
        updated_at=datetime_to_timestamp(project.updated_at),
        urn=project.urn,
        type_field_schemas=type_schemas_proto,
        tags=[tag_to_proto(tag) for tag in (tags or [])],
        task_count=task_count,
        completed_task_count=completed_task_count,
        member_count=member_count,
        overdue_task_count=overdue_task_count,
        estimated_minutes=estimated_minutes,
        time_spent_minutes=time_spent_minutes,
    )

    if resolved_baseline is not None:
        proto.baseline_role = content_role_to_proto(resolved_baseline)
    if user_role is not None:
        proto.user_role = content_role_to_proto(user_role)

    if project.deleted_at:
        proto.deleted_at.CopyFrom(datetime_to_timestamp(project.deleted_at))

    return proto


def task_to_proto(
    task: Task,
    user_role: ContentRole | None = None,
    subtask_total: int = 0,
    subtask_completed: int = 0,
    tags: list[Tag] | None = None,
) -> ProtoTask:
    field_values_map: dict[str, str] = {}
    if task.field_values:
        for key, value in task.field_values.items():
            if isinstance(value, (list, dict)):
                field_values_map[key] = dumps_str(value)
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
        number=task.number,
        task_type=task.task_type,
        field_values=field_values_map,
        outgoing_references=task.outgoing_references or [],
        created_at=datetime_to_timestamp(task.created_at),
        updated_at=datetime_to_timestamp(task.updated_at),
        urn=task.urn,
        subtask_total=subtask_total,
        subtask_completed=subtask_completed,
        tags=[tag_to_proto(tag) for tag in (tags or [])],
    )

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
    if task.sprint_id:
        proto.sprint_id = str(task.sprint_id)
    if task.estimated_minutes is not None:
        proto.estimated_minutes = task.estimated_minutes
    if task.time_spent_minutes is not None:
        proto.time_spent_minutes = task.time_spent_minutes

    if user_role is not None:
        proto.user_role = content_role_to_proto(user_role)

    return proto


def field_to_proto(field: FieldDefinition) -> ProtoFieldDefinition:
    config_json = dumps_str(field.config) if field.config else "{}"

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
    return ProtoViewConfig(
        id=view.id,
        project_id=str(view.project_id),
        name=view.name,
        type=view_type_to_proto(view.type),
        definition=definition_from_dict(view.definition, ProjectViewType(view.type)),
        owner_id=str(view.owner_id),
        visibility=VIEW_VISIBILITY_TO_PROTO[view.visibility],
        sort_order=view.sort_order,
        created_at=datetime_to_timestamp(view.created_at),
        updated_at=datetime_to_timestamp(view.updated_at),
    )


def activity_to_proto(activity: TaskActivity) -> ProtoTaskActivity:
    proto = ProtoTaskActivity(
        id=str(activity.id),
        task_id=str(activity.task_id),
        actor_id=str(activity.actor_id),
        action=activity_action_to_proto(activity.action),
        timestamp=datetime_to_timestamp(activity.timestamp),
    )

    if activity.field_id:
        proto.field_id = activity.field_id
    if activity.previous_value:
        proto.previous_value = activity.previous_value
    if activity.new_value:
        proto.new_value = activity.new_value
    return proto


def sprint_to_proto(
    sprint: Sprint,
    task_count: int = 0,
    completed_task_count: int = 0,
) -> ProtoSprint:
    proto = ProtoSprint(
        id=str(sprint.id),
        project_id=str(sprint.project_id),
        organization_id=str(sprint.organization_id),
        name=sprint.name,
        goal=sprint.goal,
        status=sprint.status,
        sort_order=sprint.sort_order,
        task_count=task_count,
        completed_task_count=completed_task_count,
        created_at=datetime_to_timestamp(sprint.created_at),
        updated_at=datetime_to_timestamp(sprint.updated_at),
    )
    if sprint.start_date:
        proto.start_date = sprint.start_date
    if sprint.end_date:
        proto.end_date = sprint.end_date
    return proto
