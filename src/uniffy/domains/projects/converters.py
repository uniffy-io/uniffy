"""Projects proto converters."""

from collections.abc import Mapping
from uuid import UUID

from uniffy_proto.projects.v1.agents_pb import (
    TaskAgentAssignment as ProtoTaskAgentAssignment,
)
from uniffy_proto.projects.v1.agents_pb import (
    TaskAgentAssignmentReason as ProtoAssignmentReason,
)
from uniffy_proto.projects.v1.agents_pb import (
    TaskAgentAssignmentStatus as ProtoAssignmentStatus,
)
from uniffy_proto.projects.v1.projects_pb import (
    ActivityAction,
    FieldType,
    ViewType,
    ViewVisibility,
)
from uniffy_proto.projects.v1.projects_pb import (
    FieldDefinition as ProtoFieldDefinition,
)
from uniffy_proto.projects.v1.projects_pb import (
    Project as ProtoProject,
)
from uniffy_proto.projects.v1.projects_pb import (
    Sprint as ProtoSprint,
)
from uniffy_proto.projects.v1.projects_pb import (
    Task as ProtoTask,
)
from uniffy_proto.projects.v1.projects_pb import (
    TaskActivity as ProtoTaskActivity,
)
from uniffy_proto.projects.v1.projects_pb import (
    TypeFieldSchema as ProtoTypeFieldSchema,
)
from uniffy_proto.projects.v1.projects_pb import (
    ViewConfig as ProtoViewConfig,
)

from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.task_assignment import TaskAssignmentReason, TaskAssignmentStatus
from uniffy.core.models.projects.activity import TaskActivity, TaskActivityAction
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
from uniffy.domains.agents.tasks.admission import AssignmentView
from uniffy.domains.projects.views.definition import definition_from_dict
from uniffy.domains.tags.converters import tag_to_proto

FIELD_TYPE_TO_PROTO: dict[str, FieldType] = {
    "text": FieldType.TEXT,
    "number": FieldType.NUMBER,
    "single_select": FieldType.SINGLE_SELECT,
    "multi_select": FieldType.MULTI_SELECT,
    "date": FieldType.DATE,
    "person": FieldType.PERSON,
    "reference": FieldType.REFERENCE,
}

FIELD_TYPE_FROM_PROTO: dict[FieldType, str] = {v: k for k, v in FIELD_TYPE_TO_PROTO.items()}

VIEW_TYPE_TO_PROTO: dict[str, ViewType] = {
    ProjectViewType.TABLE: ViewType.TABLE,
    ProjectViewType.BOARD: ViewType.BOARD,
    ProjectViewType.ROADMAP: ViewType.ROADMAP,
    ProjectViewType.BACKLOG: ViewType.BACKLOG,
    ProjectViewType.GRAPH: ViewType.GRAPH,
    ProjectViewType.RESOURCES: ViewType.RESOURCES,
}

VIEW_VISIBILITY_TO_PROTO: dict[str, ViewVisibility] = {
    ProjectViewVisibility.PERSONAL: ViewVisibility.PERSONAL,
    ProjectViewVisibility.SHARED: ViewVisibility.SHARED,
}

VIEW_VISIBILITY_FROM_PROTO: dict[ViewVisibility, ProjectViewVisibility] = {
    ViewVisibility.PERSONAL: ProjectViewVisibility.PERSONAL,
    ViewVisibility.SHARED: ProjectViewVisibility.SHARED,
}

ACTIVITY_ACTION_TO_PROTO: dict[str, ActivityAction] = {
    TaskActivityAction.CREATED: ActivityAction.CREATED,
    TaskActivityAction.TITLE_CHANGED: ActivityAction.TITLE_CHANGED,
    TaskActivityAction.DESCRIPTION_EDITED: ActivityAction.DESCRIPTION_EDITED,
    TaskActivityAction.STATUS_CHANGED: ActivityAction.STATUS_CHANGED,
    TaskActivityAction.PRIORITY_CHANGED: ActivityAction.PRIORITY_CHANGED,
    TaskActivityAction.TYPE_CHANGED: ActivityAction.TYPE_CHANGED,
    TaskActivityAction.ASSIGNED: ActivityAction.ASSIGNED,
    TaskActivityAction.START_DATE_CHANGED: ActivityAction.START_DATE_CHANGED,
    TaskActivityAction.DUE_DATE_CHANGED: ActivityAction.DUE_DATE_CHANGED,
    TaskActivityAction.SPRINT_CHANGED: ActivityAction.SPRINT_CHANGED,
    TaskActivityAction.ESTIMATE_CHANGED: ActivityAction.ESTIMATE_CHANGED,
    TaskActivityAction.PARENT_CHANGED: ActivityAction.PARENT_CHANGED,
    TaskActivityAction.RECURRENCE_CHANGED: ActivityAction.RECURRENCE_CHANGED,
    TaskActivityAction.MILESTONE_CHANGED: ActivityAction.MILESTONE_CHANGED,
    TaskActivityAction.TAGS_CHANGED: ActivityAction.TAGS_CHANGED,
    TaskActivityAction.FIELD_UPDATED: ActivityAction.FIELD_UPDATED,
    TaskActivityAction.BLOCKED_BY_ADDED: ActivityAction.BLOCKED_BY_ADDED,
    TaskActivityAction.BLOCKED_BY_REMOVED: ActivityAction.BLOCKED_BY_REMOVED,
    TaskActivityAction.BLOCKING_ADDED: ActivityAction.BLOCKING_ADDED,
    TaskActivityAction.BLOCKING_REMOVED: ActivityAction.BLOCKING_REMOVED,
    TaskActivityAction.TIME_LOGGED: ActivityAction.TIME_LOGGED,
    TaskActivityAction.TIME_UPDATED: ActivityAction.TIME_UPDATED,
    TaskActivityAction.TIME_REMOVED: ActivityAction.TIME_REMOVED,
    TaskActivityAction.AGENT_ASSIGNED: ActivityAction.AGENT_ASSIGNED,
    TaskActivityAction.AGENT_UNASSIGNED: ActivityAction.AGENT_UNASSIGNED,
}


def field_type_to_proto(field_type: str) -> FieldType:
    return FIELD_TYPE_TO_PROTO.get(field_type, FieldType.UNSPECIFIED)


def field_type_from_proto(proto_type: FieldType) -> str:
    return FIELD_TYPE_FROM_PROTO.get(proto_type, "text")


def view_type_to_proto(view_type: str) -> ViewType:
    return VIEW_TYPE_TO_PROTO.get(view_type, ViewType.UNSPECIFIED)


def view_visibility_from_proto(visibility: ViewVisibility) -> ProjectViewVisibility:
    resolved = VIEW_VISIBILITY_FROM_PROTO.get(visibility)
    if resolved is None:
        raise ValidationError("visibility", "A view must be personal or shared")
    return resolved


def activity_action_to_proto(action: str) -> ActivityAction:
    return ACTIVITY_ACTION_TO_PROTO.get(action, ActivityAction.UNSPECIFIED)


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
        proto.deleted_at = datetime_to_timestamp(project.deleted_at)
    if project.agent_assignee_id:
        proto.agent_assignee_id = str(project.agent_assignee_id)
    if project.agent_assignee_set_by:
        proto.agent_assignee_set_by_id = str(project.agent_assignee_set_by)

    return proto


def task_to_proto(
    task: Task,
    user_role: ContentRole | None = None,
    subtask_total: int = 0,
    subtask_completed: int = 0,
    tags: list[Tag] | None = None,
    agent_assignment: AssignmentView | None = None,
    viewer_id: UUID | None = None,
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
        proto.completed_at = datetime_to_timestamp(task.completed_at)
    if task.parent_id:
        proto.parent_id = str(task.parent_id)
    if task.blocked_by_task_ids:
        proto.blocked_by_task_ids.extend(task.blocked_by_task_ids)
    if task.recurrence_rule:
        proto.recurrence_rule = task.recurrence_rule
    if task.deleted_at:
        proto.deleted_at = datetime_to_timestamp(task.deleted_at)
    if task.sprint_id:
        proto.sprint_id = str(task.sprint_id)
    if task.estimated_minutes is not None:
        proto.estimated_minutes = task.estimated_minutes
    if task.time_spent_minutes is not None:
        proto.time_spent_minutes = task.time_spent_minutes

    if user_role is not None:
        proto.user_role = content_role_to_proto(user_role)
    if agent_assignment is not None:
        proto.agent_assignment = agent_assignment_to_proto(agent_assignment, viewer_id)

    return proto


_ASSIGNMENT_STATUS_TO_PROTO = {
    TaskAssignmentStatus.WAITING: ProtoAssignmentStatus.WAITING,
    TaskAssignmentStatus.PENDING: ProtoAssignmentStatus.PENDING,
    TaskAssignmentStatus.RUNNING: ProtoAssignmentStatus.RUNNING,
    TaskAssignmentStatus.COMPLETED: ProtoAssignmentStatus.COMPLETED,
    TaskAssignmentStatus.FAILED: ProtoAssignmentStatus.FAILED,
    TaskAssignmentStatus.STOPPED: ProtoAssignmentStatus.STOPPED,
    TaskAssignmentStatus.SKIPPED: ProtoAssignmentStatus.SKIPPED,
    TaskAssignmentStatus.UNCERTAIN: ProtoAssignmentStatus.UNCERTAIN,
}
_ASSIGNMENT_REASON_TO_PROTO = {
    TaskAssignmentReason.TASK: ProtoAssignmentReason.TASK,
    TaskAssignmentReason.PROJECT: ProtoAssignmentReason.PROJECT,
}


def agent_assignment_to_proto(
    view: AssignmentView, viewer_id: UUID | None
) -> ProtoTaskAgentAssignment:
    proto = ProtoTaskAgentAssignment(
        id=str(view.id),
        agent_id=str(view.agent_id),
        agent_name=view.agent_name,
        agent_is_deleted=view.agent_is_deleted,
        assigned_by_id=str(view.assigned_by),
        status=_ASSIGNMENT_STATUS_TO_PROTO[view.status],
        reason=_ASSIGNMENT_REASON_TO_PROTO[view.reason],
        created_at=datetime_to_timestamp(view.created_at),
    )
    if view.agent_avatar_emoji:
        proto.agent_avatar_emoji = view.agent_avatar_emoji
    if view.ended_at:
        proto.ended_at = datetime_to_timestamp(view.ended_at)
    if view.start_at and view.status == TaskAssignmentStatus.PENDING:
        proto.start_at = datetime_to_timestamp(view.start_at)
    # Only the person the agent works for can open its session and run stream.
    if viewer_id is not None and viewer_id == view.assigned_by:
        if view.session_id:
            proto.session_id = str(view.session_id)
        proto.run_id = str(view.run_id)
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


def activity_to_proto(
    activity: TaskActivity, agent_names: Mapping[UUID, str] | None = None
) -> ProtoTaskActivity:
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
    if activity.agent_id:
        proto.agent_id = str(activity.agent_id)
        if agent_names and activity.agent_id in agent_names:
            proto.agent_name = agent_names[activity.agent_id]
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
