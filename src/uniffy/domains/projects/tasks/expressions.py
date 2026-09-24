"""SQL for the task values a view filters and sorts by that are not a plain column."""

from datetime import date
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    CTE,
    ColumnElement,
    Date,
    DateTime,
    Numeric,
    String,
    and_,
    case,
    cast,
    exists,
    func,
    literal,
    literal_column,
    or_,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import aliased

from uniffy.core.content.references import CONTENT_URN_PREFIX
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType

TASK_URN_PREFIX = f"{CONTENT_URN_PREFIX}{ContentType.TASK.value}:"
# Cycles in parent_id stop here instead of recursing forever; the web index stops at the same depth.
MAX_ANCESTRY_DEPTH = 64
# Case- and accent-blind, digits compared as numbers ("Task 9" before
# "Task 10"), the order of the web's ``Intl.Collator({numeric: true, sensitivity: "base"})``.
NATURAL_COLLATION = "natural_sort"
# ICU lower-cases the way JavaScript and Python do ("İ" keeps its dot, a final sigma stays final).
_CASE_COLLATION = "und-x-icu"
# What JavaScript's ``String.prototype.trim`` strips.
TEXT_WHITESPACE = (
    " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009"
    "\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)

_UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
# With the length cap, every match fits ``numeric``; an unbounded exponent overflows the cast.
_NUMBER_PATTERN = r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d{1,4})?$"
_MAX_NUMBER_TEXT = 1000
_JSON_EMPTY_ARRAY = cast(literal("[]"), JSONB)
_JSON_EMPTY_STRING = cast(literal('""'), JSONB)
_JSON_NULL = "null"
_JSON_ARRAY = "array"
_JSON_STRING = "string"
_JSON_NUMBER = "number"
# The whole value as text, for a scalar: ``value #>> '{}'``.
_WHOLE = literal_column("'{}'::text[]")


def task_urn(task_id: ColumnElement[UUID]) -> ColumnElement[str]:
    return func.concat(TASK_URN_PREFIX, cast(task_id, String))


def task_column(field_id: str) -> ColumnElement:
    """The column behind a system field: ``field_due_date`` is ``Task.due_date``."""
    return getattr(Task, field_id.removeprefix("field_"))


def ancestry_cte(project_id: UUID, organization_id: UUID) -> CTE:
    """``(task_id, ancestor_id, ancestor_type, depth)``, depth 0 being the task itself; a parent
    outside the project's live tasks counts one level with a NULL ancestor, as the web counts it.
    """
    anchor = Task.__table__.alias("t_anchor")
    base = select(
        anchor.c.id.label("task_id"),
        anchor.c.id.label("ancestor_id"),
        anchor.c.task_type.label("ancestor_type"),
        anchor.c.parent_id.label("next_parent_id"),
        literal(0).label("depth"),
    ).where(
        and_(
            anchor.c.project_id == project_id,
            anchor.c.organization_id == organization_id,
            anchor.c.is_deleted == False,  # noqa: E712
        )
    )
    ancestry = base.cte(name="task_ancestry", recursive=True)
    parent = Task.__table__.alias("t_parent")
    recursive = (
        select(
            ancestry.c.task_id,
            parent.c.id.label("ancestor_id"),
            parent.c.task_type.label("ancestor_type"),
            parent.c.parent_id.label("next_parent_id"),
            (ancestry.c.depth + 1).label("depth"),
        )
        .select_from(
            ancestry.outerjoin(
                parent,
                and_(
                    parent.c.id == ancestry.c.next_parent_id,
                    parent.c.project_id == project_id,
                    parent.c.organization_id == organization_id,
                    parent.c.is_deleted == False,  # noqa: E712
                ),
            )
        )
        .where(
            and_(
                ancestry.c.next_parent_id.is_not(None),
                ancestry.c.ancestor_id.is_not(None),
                ancestry.c.depth < MAX_ANCESTRY_DEPTH,
            )
        )
    )
    return ancestry.union_all(recursive)


def json_is_empty(value: ColumnElement) -> ColumnElement[bool]:
    """Missing, null, an empty string or an empty list: what the web calls no value."""
    return or_(
        value.is_(None),
        func.jsonb_typeof(value) == _JSON_NULL,
        value == _JSON_EMPTY_ARRAY,
        value == _JSON_EMPTY_STRING,
    )


def json_text(value: ColumnElement) -> ColumnElement[str]:
    """A string value as text; any other value reads as no text."""
    return case(
        (func.jsonb_typeof(value) == _JSON_STRING, value.op("#>>")(_WHOLE)),
        else_=literal(""),
    )


def json_number(value: ColumnElement) -> ColumnElement:
    """A number, or a string holding one, as numeric; anything else is null."""
    raw = func.btrim(value.op("#>>")(_WHOLE))
    return case(
        (func.jsonb_typeof(value) == _JSON_NUMBER, cast(raw, Numeric)),
        (
            and_(
                func.jsonb_typeof(value) == _JSON_STRING,
                func.length(raw) <= _MAX_NUMBER_TEXT,
                raw.op("~")(_NUMBER_PATTERN),
            ),
            cast(raw, Numeric),
        ),
        else_=None,
    )


def json_first_id(value: ColumnElement) -> ColumnElement[str]:
    """First id of a person value, stored as a list or a bare id."""
    return case(
        (func.jsonb_typeof(value) == _JSON_ARRAY, value.op("->>")(0)),
        (func.jsonb_typeof(value) == _JSON_STRING, value.op("#>>")(_WHOLE)),
        else_=None,
    )


def as_uuid(user_id: ColumnElement[str]) -> ColumnElement[UUID]:
    """The id as a UUID, or NULL when the text is not one."""
    return case((user_id.op("~")(_UUID_PATTERN), cast(user_id, PG_UUID(as_uuid=True))))


def natural(value: ColumnElement[str]) -> ColumnElement[str]:
    return value.collate(NATURAL_COLLATION)


def lower_text(value: ColumnElement[str]) -> ColumnElement[str]:
    return func.lower(value.collate(_CASE_COLLATION))


def has_subtasks(project_id: UUID) -> ColumnElement[bool]:
    child = aliased(Task)
    return exists().where(
        and_(
            child.parent_id == Task.id,
            child.project_id == project_id,
            child.is_deleted == False,  # noqa: E712
        )
    )


def is_blocked(project_id: UUID) -> ColumnElement[bool]:
    """Incomplete with at least one live, incomplete blocker."""
    blocker = aliased(Task)
    listed = case(
        (func.jsonb_typeof(Task.blocked_by_task_ids) == _JSON_ARRAY, Task.blocked_by_task_ids),
        else_=_JSON_EMPTY_ARRAY,
    )
    blocker_ids = select(
        cast(func.jsonb_array_elements_text(listed), PG_UUID(as_uuid=True))
    ).correlate(Task)
    open_blocker = (
        exists()
        .where(
            and_(
                blocker.id.in_(blocker_ids),
                blocker.project_id == project_id,
                blocker.is_deleted == False,  # noqa: E712
                blocker.completed_at.is_(None),
            )
        )
        .correlate(Task)
    )
    return and_(Task.completed_at.is_(None), open_blocker)


def day_start(day: date, zone: ZoneInfo, offset: int = 0) -> ColumnElement:
    # PostgreSQL can represent the day after 9999-12-31; Python datetime cannot.
    calendar_day = cast(literal(day.isoformat()), Date) + offset
    return func.timezone(zone.key, cast(calendar_day, DateTime))
