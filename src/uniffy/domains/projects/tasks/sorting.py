"""Orders a task list by a view's sort keys, the way the web's ``sortTasks`` does."""

from collections.abc import Sequence

from sqlalchemy import ColumnElement, Integer, Select, String, case, cast, func, literal, select
from uniffy_proto.projects.v1.projects_pb2 import SortDirection, TaskPseudoField, TaskSort

from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
)
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task, TaskType
from uniffy.domains.directory.subjects import subject_names
from uniffy.domains.projects.tasks.expressions import (
    as_uuid,
    has_subtasks,
    is_blocked,
    json_first_id,
    json_number,
    json_text,
    natural,
    task_column,
)
from uniffy.domains.projects.tasks.filtering import TaskFilterCompiler
from uniffy.domains.projects.views.definition import RefCase

_PSEUDO = TaskPseudoField
_FIELD = SystemProjectFieldId
_TASK_TYPE_RANK = {task_type.value: rank for rank, task_type in enumerate(TaskType)}


def _as_rank(flag: ColumnElement[bool]) -> ColumnElement[int]:
    return case((flag, 1), else_=0)


def _option_rank(field: FieldDefinition, value: ColumnElement[str]) -> ColumnElement:
    """Option order; a value no option carries any more sorts with the empties."""
    options = [
        option
        for option in (field.config or {}).get("options", [])
        if isinstance(option, dict) and option.get("id") is not None
    ]
    if not options:
        return literal(None, Integer)
    return case(
        *((value == str(option["id"]), int(option.get("sortOrder", 0))) for option in options),
        else_=None,
    )


class _SortCompiler:
    def __init__(self, query: Select, filters: TaskFilterCompiler) -> None:
        self.query = query
        self.filters = filters
        self.ctx = filters.ctx
        self._depth: ColumnElement | None = None

    def depth(self) -> ColumnElement:
        if self._depth is None:
            # The filter's ancestry, so a depth filter and a depth sort share one CTE.
            ancestry = self.filters.ancestry
            depths = (
                select(ancestry.c.task_id, func.max(ancestry.c.depth).label("depth"))
                .group_by(ancestry.c.task_id)
                .subquery("task_depth")
            )
            self.query = self.query.outerjoin(depths, depths.c.task_id == Task.id)
            self._depth = depths.c.depth
        return self._depth

    def person(self, user_id: ColumnElement, as_text: ColumnElement[str]) -> ColumnElement[str]:
        names = subject_names(self.ctx.organization_id, self.ctx.current_user_id)
        self.query = self.query.outerjoin(names, names.c.subject_id == user_id)
        return natural(func.coalesce(names.c.name, as_text))

    def person_by_text(self, raw: ColumnElement[str]) -> ColumnElement[str]:
        return self.person(as_uuid(raw), raw)

    def value(self, key: TaskSort) -> ColumnElement | None:
        ref = key.field
        if ref.WhichOneof("ref") == RefCase.PSEUDO:
            return self.pseudo_value(ref.pseudo)
        field = self.ctx.fields.get(ref.field_id)
        # A saved view outlives a field it sorts by; the web drops that key.
        return self.field_value(field) if field is not None else None

    def field_value(self, field: FieldDefinition) -> ColumnElement:
        if field.id == _FIELD.TITLE:
            return natural(func.nullif(Task.title, ""))
        if field.id in (_FIELD.STATUS, _FIELD.PRIORITY):
            return _option_rank(field, task_column(field.id))
        if field.id == _FIELD.ASSIGNEE:
            return self.person_by_text(json_first_id(Task.assignee_ids))
        if field.id in (_FIELD.START_DATE, _FIELD.DUE_DATE):
            return func.nullif(task_column(field.id), "")
        value = Task.field_values[field.id]
        field_type = ProjectFieldType(field.type)
        if field_type is ProjectFieldType.SINGLE_SELECT:
            return _option_rank(field, json_text(value))
        if field_type is ProjectFieldType.PERSON:
            return self.person_by_text(json_first_id(value))
        if field_type is ProjectFieldType.NUMBER:
            return json_number(value)
        return natural(func.nullif(json_text(value), ""))

    def pseudo_value(self, pseudo: int) -> ColumnElement:
        project_id = self.ctx.project_id
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_SPRINT:
            return (
                select(Sprint.sort_order)
                .where(Sprint.id == Task.sprint_id, Sprint.project_id == project_id)
                .scalar_subquery()
            )
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_TASK_TYPE:
            task_type = func.coalesce(func.nullif(Task.task_type, ""), TaskType.TASK.value)
            return case(
                *((task_type == value, rank) for value, rank in _TASK_TYPE_RANK.items()),
                else_=None,
            )
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_CREATOR:
            return self.person(Task.owner_id, cast(Task.owner_id, String))
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_DEPTH:
            return func.coalesce(self.depth(), 0)
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_HAS_SUBTASKS:
            return _as_rank(has_subtasks(project_id))
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_IS_MILESTONE:
            return cast(Task.is_milestone, Integer)
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_IS_BLOCKED:
            return _as_rank(is_blocked(project_id))
        columns = {
            _PSEUDO.TASK_PSEUDO_FIELD_CREATED_AT: Task.created_at,
            _PSEUDO.TASK_PSEUDO_FIELD_UPDATED_AT: Task.updated_at,
            _PSEUDO.TASK_PSEUDO_FIELD_COMPLETED_AT: Task.completed_at,
            _PSEUDO.TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: Task.estimated_minutes,
            _PSEUDO.TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: Task.time_spent_minutes,
            _PSEUDO.TASK_PSEUDO_FIELD_NUMBER: Task.number,
        }
        return columns[pseudo]


def apply_task_sort(query: Select, keys: Sequence[TaskSort], filters: TaskFilterCompiler) -> Select:
    """Empty values sort last in both directions; ties fall back to the manual order."""
    compiler = _SortCompiler(query, filters)
    order = []
    for key in keys:
        value = compiler.value(key)
        if value is None:
            continue
        ordered = value.desc() if key.direction == SortDirection.SORT_DIRECTION_DESC else value.asc()
        order.append(ordered.nulls_last())
    # ``id`` makes the order total, so offset pages partition the set even when keys tie.
    return compiler.query.order_by(*order, Task.sort_order.asc(), Task.number.asc(), Task.id.asc())
