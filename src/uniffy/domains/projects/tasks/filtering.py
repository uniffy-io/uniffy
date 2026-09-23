"""Compiles a view's filter tree into a condition on ``projects_tasks``, as the web evaluates it."""

import calendar
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    CTE,
    ColumnElement,
    and_,
    cast,
    exists,
    false,
    func,
    literal,
    not_,
    or_,
    select,
    true,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.types import Text
from uniffy_proto.projects.v1.projects_pb2 import (
    FilterLogic,
    RelativeDateAnchor,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterOperator,
    TaskPseudoField,
)

from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
)
from uniffy.core.models.projects.task import Task, TaskType
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.domains.projects.tasks.expressions import (
    TEXT_WHITESPACE,
    ancestry_cte,
    day_start,
    has_subtasks,
    is_blocked,
    json_is_empty,
    json_number,
    json_text,
    lower_text,
    task_column,
    task_urn,
)
from uniffy.domains.projects.views.catalog import (
    FIELD_TYPE_KINDS,
    PSEUDO_FIELD_KINDS,
    UUID_ID_KINDS,
    FieldKind,
)
from uniffy.domains.projects.views.definition import DateCase, NodeCase, RefCase

_OP = TaskFilterOperator
_PSEUDO = TaskPseudoField

_FIELD = SystemProjectFieldId
_TEXT_COLUMN_FIELDS = frozenset({
    _FIELD.TITLE,
    _FIELD.STATUS,
    _FIELD.PRIORITY,
    _FIELD.START_DATE,
    _FIELD.DUE_DATE,
})


@dataclass(frozen=True)
class FilterContext:
    """What a filter resolves against at evaluation time, per caller."""

    organization_id: UUID
    project_id: UUID
    current_user_id: UUID
    active_sprint_id: UUID | None
    today: date
    # Weekday the week starts on, Monday being 0.
    week_start: int
    zone: ZoneInfo
    fields: Mapping[str, FieldDefinition] = field(default_factory=dict)


def resolve_filter_date(value: TaskFilterDate, today: date, week_start: int) -> date:
    """Relative dates count whole calendar days, so a DST change never moves them."""
    if value.WhichOneof("value") == DateCase.FIXED:
        return date.fromisoformat(value.fixed)
    anchor = value.relative.anchor
    base = today
    if anchor in (
        RelativeDateAnchor.RELATIVE_DATE_ANCHOR_START_OF_WEEK,
        RelativeDateAnchor.RELATIVE_DATE_ANCHOR_END_OF_WEEK,
    ):
        start = today - timedelta(days=(today.weekday() - week_start) % 7)
        base = (
            start
            if anchor == RelativeDateAnchor.RELATIVE_DATE_ANCHOR_START_OF_WEEK
            else start + timedelta(days=6)
        )
    elif anchor == RelativeDateAnchor.RELATIVE_DATE_ANCHOR_START_OF_MONTH:
        base = today.replace(day=1)
    elif anchor == RelativeDateAnchor.RELATIVE_DATE_ANCHOR_END_OF_MONTH:
        base = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    return base + timedelta(days=value.relative.offset_days)


class _Ids(Protocol):
    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]: ...

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]: ...

    def empty(self) -> ColumnElement[bool]: ...


@dataclass(frozen=True)
class _ScalarIds:
    """One id in a column."""

    column: ColumnElement
    parse: Callable[[str], Any] = str

    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        return self.column.in_([self.parse(raw) for raw in ids])

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        distinct = set(ids)
        if len(distinct) != 1:
            return false()
        return self.any_of(list(distinct))

    def empty(self) -> ColumnElement[bool]:
        return self.column.is_(None)


@dataclass(frozen=True)
class _JsonColumnIds:
    """A JSONB list of ids in its own column; the GIN index answers ``?|`` and ``?&``."""

    column: ColumnElement

    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        return self.column.op("?|")(_text_array(ids))

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        return self.column.op("?&")(_text_array(ids))

    def empty(self) -> ColumnElement[bool]:
        return json_is_empty(self.column)


@dataclass(frozen=True)
class _CustomFieldIds:
    """A custom field holding one id or a list; containment keeps the ``field_values`` index."""

    field_id: str

    def _holds(self, value: Any) -> ColumnElement[bool]:
        return Task.field_values.op("@>")(cast(literal({self.field_id: value}, JSONB), JSONB))

    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        return or_(*(or_(self._holds(raw), self._holds([raw])) for raw in ids))

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        distinct = sorted(set(ids))
        held = self._holds(distinct)
        if len(distinct) == 1:
            held = or_(held, self._holds(distinct[0]))
        return held

    def empty(self) -> ColumnElement[bool]:
        return json_is_empty(Task.field_values[self.field_id])


@dataclass(frozen=True)
class _TagIds:
    """Correlated on the task's URN, which the ``(tag_id, content_urn)`` key answers per task."""

    def _assigned(self, tag_ids: set[UUID]):
        return and_(
            TagAssignment.content_urn == task_urn(Task.id),
            TagAssignment.tag_id.in_(tag_ids),
        )

    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        return exists().where(self._assigned({UUID(raw) for raw in ids}))

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        distinct = {UUID(raw) for raw in ids}
        held = (
            select(func.count(func.distinct(TagAssignment.tag_id)))
            .where(self._assigned(distinct))
            .scalar_subquery()
        )
        return held == len(distinct)

    def empty(self) -> ColumnElement[bool]:
        return not_(exists().where(TagAssignment.content_urn == task_urn(Task.id)))


@dataclass(frozen=True)
class _EpicIds:
    """The task itself when it is an epic, and every epic above it."""

    ancestry: CTE

    def _rows(self):
        return select(self.ancestry.c.task_id).where(
            self.ancestry.c.ancestor_type == TaskType.EPIC.value
        )

    def any_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        rows = self._rows().where(self.ancestry.c.ancestor_id.in_([UUID(raw) for raw in ids]))
        return Task.id.in_(rows)

    def all_of(self, ids: Sequence[str]) -> ColumnElement[bool]:
        distinct = {UUID(raw) for raw in ids}
        rows = (
            self
            ._rows()
            .where(self.ancestry.c.ancestor_id.in_(distinct))
            .group_by(self.ancestry.c.task_id)
            .having(func.count(func.distinct(self.ancestry.c.ancestor_id)) == len(distinct))
        )
        return Task.id.in_(rows)

    def empty(self) -> ColumnElement[bool]:
        return not_(Task.id.in_(self._rows()))


def _text_array(ids: Sequence[str]) -> ColumnElement:
    return cast(literal(list(ids), ARRAY(Text)), ARRAY(Text))


@dataclass
class TaskFilterCompiler:
    ctx: FilterContext
    _ancestry: CTE | None = None

    @property
    def ancestry(self) -> CTE:
        if self._ancestry is None:
            self._ancestry = ancestry_cte(self.ctx.project_id, self.ctx.organization_id)
        return self._ancestry

    def compile(self, group: TaskFilterGroup) -> ColumnElement[bool]:
        # Conditions stay bare so the planner can match them to an index.
        nodes = [self._node(node) for node in group.nodes]
        if not nodes:
            return true()
        return or_(*nodes) if group.logic == FilterLogic.FILTER_LOGIC_OR else and_(*nodes)

    def _node(self, node) -> ColumnElement[bool]:
        if node.WhichOneof("node") == NodeCase.GROUP:
            return self.compile(node.group)
        return self._condition(node.condition)

    def _kind(self, ref: TaskFieldRef) -> FieldKind:
        if ref.WhichOneof("ref") == RefCase.PSEUDO:
            return PSEUDO_FIELD_KINDS[ref.pseudo]
        return FIELD_TYPE_KINDS[ProjectFieldType(self.ctx.fields[ref.field_id].type)]

    def _condition(self, condition: TaskFilterCondition) -> ColumnElement[bool]:
        ref = condition.field
        if ref.WhichOneof("ref") == RefCase.FIELD_ID and ref.field_id not in self.ctx.fields:
            # A saved view outlives a field it names; that condition matches nothing.
            return false()
        kind = self._kind(ref)
        operator = condition.operator
        if operator == _OP.TASK_FILTER_OPERATOR_IS_EMPTY:
            return self._empty(ref, kind)
        if operator == _OP.TASK_FILTER_OPERATOR_IS_NOT_EMPTY:
            return not_(self._empty(ref, kind))
        if kind is FieldKind.BOOLEAN:
            expression = self._flag(ref)
            return expression if condition.value.flag else not_(expression)
        if kind is FieldKind.TEXT:
            return self._text(self._text_value(ref), condition)
        if kind is FieldKind.NUMBER:
            return self._number(ref, condition)
        if kind in (FieldKind.DATE, FieldKind.TIMESTAMP):
            return self._date(ref, kind, condition)
        return self._ids(self._id_source(ref), kind, operator, condition.value.ids)

    def _wanted(self, id_set: TaskFilterIdSet, kind: FieldKind) -> list[str]:
        # Stored ids are lower-case; an id written in capitals still names the same row.
        wanted = [str(UUID(raw)) if kind in UUID_ID_KINDS else raw for raw in id_set.ids]
        if id_set.include_current_user:
            wanted.append(str(self.ctx.current_user_id))
        if id_set.include_active_sprint and self.ctx.active_sprint_id is not None:
            wanted.append(str(self.ctx.active_sprint_id))
        return wanted

    def _ids(
        self,
        source: _Ids,
        kind: FieldKind,
        operator: TaskFilterOperator,
        id_set: TaskFilterIdSet,
    ) -> ColumnElement[bool]:
        wanted = self._wanted(id_set, kind)
        if operator == _OP.TASK_FILTER_OPERATOR_IS_ALL_OF:
            return source.all_of(wanted) if wanted else false()
        hit = source.any_of(wanted) if wanted else false()
        if id_set.include_empty:
            hit = or_(hit, source.empty())
        if operator in (_OP.TASK_FILTER_OPERATOR_IS_NOT, _OP.TASK_FILTER_OPERATOR_IS_NONE_OF):
            # A task with no value is "not" every value: NULL is not true.
            return hit.is_not(true())
        return hit

    def _id_source(self, ref: TaskFieldRef) -> _Ids:
        if ref.WhichOneof("ref") == RefCase.FIELD_ID:
            if ref.field_id in (_FIELD.STATUS, _FIELD.PRIORITY):
                return _ScalarIds(task_column(ref.field_id))
            if ref.field_id == _FIELD.ASSIGNEE:
                return _JsonColumnIds(Task.assignee_ids)
            return _CustomFieldIds(ref.field_id)
        pseudo = ref.pseudo
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_TAGS:
            return _TagIds()
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_EPIC:
            return _EpicIds(self.ancestry)
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_BLOCKED_BY:
            return _JsonColumnIds(Task.blocked_by_task_ids)
        if pseudo == _PSEUDO.TASK_PSEUDO_FIELD_TASK_TYPE:
            return _ScalarIds(func.coalesce(func.nullif(Task.task_type, ""), TaskType.TASK.value))
        columns = {
            _PSEUDO.TASK_PSEUDO_FIELD_SPRINT: Task.sprint_id,
            _PSEUDO.TASK_PSEUDO_FIELD_CREATOR: Task.owner_id,
            _PSEUDO.TASK_PSEUDO_FIELD_PARENT: Task.parent_id,
        }
        return _ScalarIds(columns[pseudo], UUID)

    def _empty(self, ref: TaskFieldRef, kind: FieldKind) -> ColumnElement[bool]:
        if ref.WhichOneof("ref") == RefCase.FIELD_ID:
            if ref.field_id in _TEXT_COLUMN_FIELDS:
                column = task_column(ref.field_id)
                return or_(column.is_(None), column == "")
            if ref.field_id == _FIELD.ASSIGNEE:
                return json_is_empty(Task.assignee_ids)
            return json_is_empty(Task.field_values[ref.field_id])
        pseudo = ref.pseudo
        if kind in (FieldKind.TAGS, FieldKind.EPIC, FieldKind.TASK_REF_SET):
            return self._id_source(ref).empty()
        columns = {
            _PSEUDO.TASK_PSEUDO_FIELD_SPRINT: Task.sprint_id,
            _PSEUDO.TASK_PSEUDO_FIELD_PARENT: Task.parent_id,
            _PSEUDO.TASK_PSEUDO_FIELD_COMPLETED_AT: Task.completed_at,
            _PSEUDO.TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: Task.estimated_minutes,
            _PSEUDO.TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: Task.time_spent_minutes,
        }
        column = columns.get(pseudo)
        # The validator refuses emptiness on attributes that always hold a value.
        return column.is_(None) if column is not None else false()

    def _flag(self, ref: TaskFieldRef) -> ColumnElement[bool]:
        if ref.pseudo == _PSEUDO.TASK_PSEUDO_FIELD_HAS_SUBTASKS:
            return has_subtasks(self.ctx.project_id)
        if ref.pseudo == _PSEUDO.TASK_PSEUDO_FIELD_IS_BLOCKED:
            return is_blocked(self.ctx.project_id)
        return Task.is_milestone

    def _text_value(self, ref: TaskFieldRef) -> ColumnElement[str]:
        if ref.field_id == _FIELD.TITLE:
            return func.coalesce(Task.title, "")
        return json_text(Task.field_values[ref.field_id])

    def _text(self, have: ColumnElement[str], condition: TaskFilterCondition) -> ColumnElement[bool]:
        # Both sides lower-case through the same function, so no character folds differently.
        wanted = lower_text(literal(condition.value.text.strip(TEXT_WHITESPACE)))
        lowered = lower_text(have)
        operator = condition.operator
        if operator in (_OP.TASK_FILTER_OPERATOR_CONTAINS, _OP.TASK_FILTER_OPERATOR_NOT_CONTAINS):
            hit = func.strpos(lowered, wanted) > 0
            return hit if operator == _OP.TASK_FILTER_OPERATOR_CONTAINS else not_(hit)
        same = func.btrim(lowered, TEXT_WHITESPACE) == wanted
        return same if operator == _OP.TASK_FILTER_OPERATOR_IS else not_(same)

    def _number(self, ref: TaskFieldRef, condition: TaskFilterCondition) -> ColumnElement[bool]:
        if ref.WhichOneof("ref") == RefCase.PSEUDO:
            if ref.pseudo == _PSEUDO.TASK_PSEUDO_FIELD_DEPTH:
                ancestry = self.ancestry
                depth = func.max(ancestry.c.depth)
                matching = (
                    select(ancestry.c.task_id)
                    .group_by(ancestry.c.task_id)
                    .having(_compare_number(depth, condition))
                )
                return Task.id.in_(matching)
            columns = {
                _PSEUDO.TASK_PSEUDO_FIELD_ESTIMATED_MINUTES: Task.estimated_minutes,
                _PSEUDO.TASK_PSEUDO_FIELD_TIME_SPENT_MINUTES: Task.time_spent_minutes,
                _PSEUDO.TASK_PSEUDO_FIELD_NUMBER: Task.number,
            }
            return _compare_number(columns[ref.pseudo], condition)
        return _compare_number(json_number(Task.field_values[ref.field_id]), condition)

    def _date(
        self, ref: TaskFieldRef, kind: FieldKind, condition: TaskFilterCondition
    ) -> ColumnElement[bool]:
        value = condition.value
        resolve = self._resolve_date
        if condition.operator == _OP.TASK_FILTER_OPERATOR_BETWEEN:
            bounds = (resolve(value.date_range.start), resolve(value.date_range.end))
        else:
            day = resolve(value.date)
            bounds = _DAY_BOUNDS[condition.operator](day)
        if kind is FieldKind.TIMESTAMP:
            return self._instant_between(_timestamp_column(ref.pseudo), bounds)
        have = self._day_text(ref)
        start, end = bounds
        conditions = [have != ""]
        if start is not None:
            conditions.append(have >= start.isoformat())
        if end is not None:
            conditions.append(have <= end.isoformat())
        return and_(*conditions)

    def _resolve_date(self, value: TaskFilterDate) -> date:
        return resolve_filter_date(value, self.ctx.today, self.ctx.week_start)

    def _day_text(self, ref: TaskFieldRef) -> ColumnElement[str]:
        if ref.field_id in (_FIELD.START_DATE, _FIELD.DUE_DATE):
            return task_column(ref.field_id)
        return json_text(Task.field_values[ref.field_id])

    def _instant_between(
        self, column: ColumnElement, bounds: tuple[date | None, date | None]
    ) -> ColumnElement[bool]:
        start, end = bounds
        conditions = [column.is_not(None)]
        if start is not None:
            conditions.append(column >= day_start(start, self.ctx.zone))
        if end is not None:
            conditions.append(column < day_start(end + timedelta(days=1), self.ctx.zone))
        return and_(*conditions)


def _timestamp_column(pseudo: int) -> ColumnElement:
    return {
        _PSEUDO.TASK_PSEUDO_FIELD_CREATED_AT: Task.created_at,
        _PSEUDO.TASK_PSEUDO_FIELD_UPDATED_AT: Task.updated_at,
        _PSEUDO.TASK_PSEUDO_FIELD_COMPLETED_AT: Task.completed_at,
    }[pseudo]


# Inclusive calendar-day bounds per comparison; None leaves that side open.
_DAY_BOUNDS: dict[int, Callable[[date], tuple[date | None, date | None]]] = {
    _OP.TASK_FILTER_OPERATOR_IS: lambda day: (day, day),
    _OP.TASK_FILTER_OPERATOR_BEFORE: lambda day: (None, day - timedelta(days=1)),
    _OP.TASK_FILTER_OPERATOR_AFTER: lambda day: (day + timedelta(days=1), None),
    _OP.TASK_FILTER_OPERATOR_ON_OR_BEFORE: lambda day: (None, day),
    _OP.TASK_FILTER_OPERATOR_ON_OR_AFTER: lambda day: (day, None),
}


def _compare_number(have: ColumnElement, condition: TaskFilterCondition) -> ColumnElement[bool]:
    value = condition.value
    operator = condition.operator
    if operator == _OP.TASK_FILTER_OPERATOR_IS_NOT:
        return or_(have.is_(None), have != value.number)
    if operator == _OP.TASK_FILTER_OPERATOR_IS:
        return have == value.number
    if operator == _OP.TASK_FILTER_OPERATOR_GREATER_THAN:
        return have > value.number
    if operator == _OP.TASK_FILTER_OPERATOR_LESS_THAN:
        return have < value.number
    return and_(have >= value.number_range.min, have <= value.number_range.max)


def compile_task_filter(group: TaskFilterGroup, ctx: FilterContext) -> ColumnElement[bool]:
    return TaskFilterCompiler(ctx).compile(group)
