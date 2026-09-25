"""Task request fields as the keyword arguments task operations take."""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.projects.v1.projects_pb import (
    BulkUpdateTasksRequest,
    CreateTaskRequest,
    UpdateTaskRequest,
)

from uniffy.core.json_codec import loads
from uniffy.domains.projects.rpc import parse_uuid


def parse_tag_ids(raw_ids) -> list[UUID]:
    out: list[UUID] = []
    for raw in raw_ids or ():
        try:
            out.append(UUID(raw))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid tag_id") from exc
    return out


def _parse_field_values(raw: Mapping[str, str]) -> dict:
    """Values arrive JSON-encoded; a value that is not JSON is kept as the plain string."""
    field_values: dict = {}
    for key, value in raw.items():
        try:
            field_values[key] = loads(value)
        except ValueError:
            field_values[key] = value
    return field_values


def create_task_arguments(request: CreateTaskRequest) -> dict[str, Any]:
    kwargs: dict = {
        "description": request.description if request.has_field("description") else "",
        "status": request.status if request.has_field("status") else "status_todo",
        "priority": (request.priority if request.has_field("priority") else "priority_medium"),
        "task_type": request.task_type if request.has_field("task_type") else "task",
    }

    if request.assignee_ids:
        kwargs["assignee_ids"] = list(request.assignee_ids)
    if request.has_field("start_date"):
        kwargs["start_date"] = request.start_date
    if request.has_field("due_date"):
        kwargs["due_date"] = request.due_date
    if request.has_field("parent_id"):
        kwargs["parent_id"] = (
            parse_uuid(request.parent_id, "parent_id") if request.parent_id else None
        )
    if request.blocked_by_task_ids:
        kwargs["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
    if request.has_field("is_milestone"):
        kwargs["is_milestone"] = request.is_milestone
    if request.has_field("recurrence_rule"):
        kwargs["recurrence_rule"] = request.recurrence_rule
    if request.has_field("sprint_id"):
        kwargs["sprint_id"] = (
            parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
        )
    if request.has_field("estimated_minutes"):
        kwargs["estimated_minutes"] = request.estimated_minutes or None
    if request.has_field("time_spent_minutes"):
        kwargs["time_spent_minutes"] = request.time_spent_minutes or None
    if request.field_values:
        kwargs["field_values"] = _parse_field_values(request.field_values)
    return kwargs


def update_task_arguments(request: UpdateTaskRequest) -> dict[str, Any]:
    updates: dict = {}
    if request.has_field("title"):
        updates["title"] = request.title
    if request.has_field("description"):
        updates["description"] = request.description
    if request.has_field("status"):
        updates["status"] = request.status
    if request.has_field("priority"):
        updates["priority"] = request.priority
    if request.has_field("assignee_ids"):
        updates["assignee_ids"] = list(request.assignee_ids.ids)
    if request.has_field("start_date"):
        updates["start_date"] = request.start_date or None
    if request.has_field("due_date"):
        updates["due_date"] = request.due_date or None
    if request.has_field("parent_id"):
        updates["parent_id"] = (
            parse_uuid(request.parent_id, "parent_id") if request.parent_id else None
        )
    if request.blocked_by_task_ids:
        updates["blocked_by_task_ids"] = list(request.blocked_by_task_ids)
    if request.has_field("is_milestone"):
        updates["is_milestone"] = request.is_milestone
    if request.has_field("recurrence_rule"):
        updates["recurrence_rule"] = request.recurrence_rule
    if request.has_field("sort_order"):
        updates["sort_order"] = request.sort_order
    if request.has_field("task_type"):
        updates["task_type"] = request.task_type
    if request.has_field("sprint_id"):
        updates["sprint_id"] = (
            parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
        )
    if request.has_field("estimated_minutes"):
        updates["estimated_minutes"] = request.estimated_minutes or None
    if request.has_field("time_spent_minutes"):
        updates["time_spent_minutes"] = request.time_spent_minutes or None
    if request.field_values:
        updates["field_values"] = _parse_field_values(request.field_values)
    if request.has_field("tag_ids"):
        updates["tag_ids"] = parse_tag_ids(list(request.tag_ids.ids))
    return updates


def bulk_update_arguments(request: BulkUpdateTasksRequest) -> dict[str, Any]:
    changes: dict = {}
    if request.has_field("status"):
        changes["status"] = request.status
    if request.has_field("priority"):
        changes["priority"] = request.priority
    if request.assignee_ids:
        changes["assignee_ids"] = list(request.assignee_ids)
    if request.has_field("sprint_id"):
        changes["sprint_id"] = (
            parse_uuid(request.sprint_id, "sprint_id") if request.sprint_id else None
        )
    return changes
