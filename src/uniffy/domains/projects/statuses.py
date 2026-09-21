"""Task-status semantics resolved from the system status-field configuration."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import (
    DefaultTaskStatusId,
    FieldDefinition,
    SystemProjectFieldId,
    TaskStatusSemantic,
)
from uniffy.core.models.projects.task import Task

_LEGACY_SEMANTICS = {
    DefaultTaskStatusId.TODO: TaskStatusSemantic.TODO,
    DefaultTaskStatusId.IN_PROGRESS: TaskStatusSemantic.IN_PROGRESS,
    DefaultTaskStatusId.REVIEW: TaskStatusSemantic.REVIEW,
    DefaultTaskStatusId.COMPLETED: TaskStatusSemantic.COMPLETED,
}
_REQUIRED_SEMANTICS = (
    TaskStatusSemantic.TODO,
    TaskStatusSemantic.IN_PROGRESS,
    TaskStatusSemantic.COMPLETED,
)


@dataclass(frozen=True)
class TaskStatusSemantics:
    ids: dict[TaskStatusSemantic, str]

    def id_for(self, semantic: TaskStatusSemantic) -> str:
        try:
            return self.ids[semantic]
        except KeyError as exc:
            raise ValidationError(
                "status",
                f"The project status field has no {semantic.value!r} semantic option",
            ) from exc

    def semantic_for(self, status_id: str) -> TaskStatusSemantic | None:
        return next(
            (semantic for semantic, configured_id in self.ids.items() if configured_id == status_id),
            None,
        )

    def is_completed(self, status_id: str) -> bool:
        return self.semantic_for(status_id) is TaskStatusSemantic.COMPLETED


def parse_task_status_semantics(
    config: dict[str, Any] | None,
    *,
    require_explicit: bool = False,
) -> TaskStatusSemantics:
    options = (config or {}).get("options")
    if not isinstance(options, list):
        options = []

    ids: dict[TaskStatusSemantic, str] = {}
    duplicates: set[TaskStatusSemantic] = set()
    for option in options:
        if not isinstance(option, dict):
            continue
        option_id = option.get("id")
        if not isinstance(option_id, str) or not option_id:
            continue
        raw_semantic = option.get("semantic")
        if raw_semantic is None and not require_explicit:
            raw_semantic = _LEGACY_SEMANTICS.get(option_id)
        try:
            semantic = TaskStatusSemantic(raw_semantic)
        except TypeError, ValueError:
            continue
        if semantic in ids:
            duplicates.add(semantic)
        else:
            ids[semantic] = option_id

    missing = [semantic.value for semantic in _REQUIRED_SEMANTICS if semantic not in ids]
    if missing or duplicates:
        details: list[str] = []
        if missing:
            details.append(f"missing semantic options: {', '.join(missing)}")
        if duplicates:
            details.append(
                "duplicate semantic options: "
                + ", ".join(sorted(semantic.value for semantic in duplicates))
            )
        raise ValidationError("config_json", "; ".join(details))

    return TaskStatusSemantics(ids)


async def load_task_status_semantics(
    session: AsyncSession,
    project_id: UUID,
) -> TaskStatusSemantics:
    result = await session.execute(
        select(FieldDefinition.config).where(
            FieldDefinition.project_id == project_id,
            FieldDefinition.id == SystemProjectFieldId.STATUS,
        )
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise ValidationError("status", "The project status field is missing")
    return parse_task_status_semantics(config)


def _option_labels(config: dict[str, Any] | None) -> dict[str, str]:
    options = (config or {}).get("options")
    if not isinstance(options, list):
        return {}
    labels: dict[str, str] = {}
    for option in options:
        if isinstance(option, dict) and isinstance(option.get("id"), str) and option["id"]:
            label = option.get("label")
            labels[option["id"]] = label if isinstance(label, str) and label else option["id"]
    return labels


def removed_status_labels(
    previous: dict[str, Any] | None,
    updated: dict[str, Any] | None,
) -> dict[str, str]:
    """Options present before an edit and missing after it, keyed by id."""
    kept = _option_labels(updated)
    return {
        option_id: label
        for option_id, label in _option_labels(previous).items()
        if option_id not in kept
    }


async def ensure_removed_statuses_unused(
    session: AsyncSession,
    project_id: UUID,
    previous: dict[str, Any] | None,
    updated: dict[str, Any] | None,
) -> None:
    """A task whose status disappears drops off every board column, so its move comes first."""
    removed = removed_status_labels(previous, updated)
    if not removed:
        return
    result = await session.execute(
        select(Task.status)
        .where(
            Task.project_id == project_id,
            Task.is_deleted.is_(False),
            Task.status.in_(list(removed)),
        )
        .distinct()
        .order_by(Task.status)
    )
    in_use = [removed[status] for status in result.scalars()]
    if in_use:
        raise ValidationError(
            "config_json",
            f"Move the tasks in {', '.join(repr(label) for label in in_use)} to another status "
            "before removing it",
        )
