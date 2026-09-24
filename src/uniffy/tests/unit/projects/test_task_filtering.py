"""The filter and sort compilers against the shared case file, without a database."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from uniffy_proto.projects.v1.projects_pb2 import (
    FilterLogic,
    RelativeDate,
    RelativeDateAnchor,
    SortDirection,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterNode,
    TaskFilterOperator,
    TaskFilterValue,
    TaskPseudoField,
    TaskSort,
)

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.task import Task
from uniffy.core.types import generate_id
from uniffy.domains.projects.tasks import reader as reader_module
from uniffy.domains.projects.tasks.filtering import (
    FilterContext,
    TaskFilterCompiler,
    compile_task_filter,
    resolve_filter_date,
)
from uniffy.domains.projects.tasks.reader import TaskReader
from uniffy.domains.projects.tasks.sorting import apply_task_sort
from uniffy.domains.projects.views.catalog import (
    FIELD_TYPE_KINDS,
    PSEUDO_FIELD_KINDS,
    SORTABLE_KINDS,
    FieldKind,
)
from uniffy.domains.projects.views.definition import (
    NodeCase,
    RefCase,
    validate_task_filter,
    validate_task_sort,
)
from uniffy.domains.settings.preferences import UserCalendarPreferences
from uniffy.tests.view_filter_cases import (
    CASES,
    field_definitions,
    sort_keys,
    symbols,
    task_filter,
)

PROJECT_ID = generate_id()
FIELDS = field_definitions(PROJECT_ID)
IDS = symbols()
CTX = FilterContext(
    organization_id=generate_id(),
    project_id=PROJECT_ID,
    current_user_id=IDS["user-me"],
    active_sprint_id=IDS["sprint-1"],
    today=date(2026, 9, 23),
    week_start=0,
    zone=ZoneInfo("UTC"),
    fields={field.id: field for field in FIELDS},
)
_Anchor = RelativeDateAnchor


def _compiles(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def _kinds(group: TaskFilterGroup) -> set[FieldKind]:
    kinds: set[FieldKind] = set()
    for node in group.nodes:
        if node.WhichOneof("node") == NodeCase.GROUP:
            kinds |= _kinds(node.group)
            continue
        ref = node.condition.field
        if ref.WhichOneof("ref") == RefCase.PSEUDO:
            kinds.add(PSEUDO_FIELD_KINDS[ref.pseudo])
        elif ref.field_id in CTX.fields:
            kinds.add(FIELD_TYPE_KINDS[CTX.fields[ref.field_id].type])
    return kinds


def _operators(group: TaskFilterGroup) -> set[int]:
    operators: set[int] = set()
    for node in group.nodes:
        if node.WhichOneof("node") == NodeCase.GROUP:
            operators |= _operators(node.group)
        else:
            operators.add(node.condition.operator)
    return operators


@pytest.mark.parametrize("case", CASES["filters"], ids=lambda case: case["name"])
def test_filter_case_validates_and_compiles(case: dict) -> None:
    group = validate_task_filter(task_filter(case, IDS), FIELDS)
    assert "WHERE" in _compiles(select(Task.id).where(compile_task_filter(group, CTX)))


@pytest.mark.parametrize("case", CASES["rejected_filters"], ids=lambda case: case["name"])
def test_rejected_case_names_the_field(case: dict) -> None:
    with pytest.raises(ValidationError) as error:
        validate_task_filter(task_filter(case, IDS), FIELDS)
    assert "gone" in error.value.message


@pytest.mark.parametrize("case", CASES["sorts"], ids=lambda case: case["name"])
def test_sort_case_validates_and_compiles(case: dict) -> None:
    keys = sort_keys(case, IDS)
    validate_task_sort(keys, FIELDS)
    sql = _compiles(apply_task_sort(select(Task), keys, TaskFilterCompiler(CTX)))
    assert sql.rstrip().endswith(
        "projects_tasks.sort_order ASC, projects_tasks.number ASC, projects_tasks.id ASC"
    )


def test_cases_reach_every_operator_and_field_kind() -> None:
    groups = [task_filter(case, IDS) for case in CASES["filters"]]
    operators = set().union(*(_operators(group) for group in groups))
    kinds = set().union(*(_kinds(group) for group in groups))
    every_operator = set(TaskFilterOperator.values()) - {
        TaskFilterOperator.TASK_FILTER_OPERATOR_UNSPECIFIED
    }
    assert every_operator - operators == set()
    assert set(FieldKind) - kinds == set()

    sorted_kinds = set()
    for case in CASES["sorts"]:
        for key in sort_keys(case, IDS):
            ref = key.field
            sorted_kinds.add(
                PSEUDO_FIELD_KINDS[ref.pseudo]
                if ref.WhichOneof("ref") == RefCase.PSEUDO
                else FIELD_TYPE_KINDS[CTX.fields[ref.field_id].type]
            )
    assert SORTABLE_KINDS - sorted_kinds == set()


def _relative(anchor: int, offset: int = 0) -> TaskFilterDate:
    return TaskFilterDate(relative=RelativeDate(anchor=anchor, offset_days=offset))


@pytest.mark.parametrize(
    ("week_start", "expected"),
    [(0, date(2026, 9, 21)), (6, date(2026, 9, 20)), (5, date(2026, 9, 19))],
)
def test_weeks_start_on_the_preferred_day(week_start: int, expected: date) -> None:
    today = date(2026, 9, 23)
    start = _relative(_Anchor.RELATIVE_DATE_ANCHOR_START_OF_WEEK)
    end = _relative(_Anchor.RELATIVE_DATE_ANCHOR_END_OF_WEEK)
    assert resolve_filter_date(start, today, week_start) == expected
    assert (resolve_filter_date(end, today, week_start) - expected).days == 6


def test_month_ends_and_offsets() -> None:
    today = date(2026, 2, 10)
    end = _relative(_Anchor.RELATIVE_DATE_ANCHOR_END_OF_MONTH, 1)
    start = _relative(_Anchor.RELATIVE_DATE_ANCHOR_START_OF_MONTH, -1)
    assert resolve_filter_date(end, today, 0) == date(2026, 3, 1)
    assert resolve_filter_date(start, today, 0) == date(2026, 1, 31)
    assert resolve_filter_date(TaskFilterDate(fixed="2026-01-02"), today, 0) == date(2026, 1, 2)


async def _context(
    monkeypatch: pytest.MonkeyPatch,
    profile_zone: str | None,
    request_zone: str | None,
    now: datetime,
) -> FilterContext:
    monkeypatch.setattr(
        reader_module,
        "get_user_calendar_preferences",
        AsyncMock(return_value=UserCalendarPreferences(profile_zone, 6)),
    )
    sprint = MagicMock()
    sprint.scalar_one_or_none.return_value = None
    session = MagicMock()
    session.execute = AsyncMock(return_value=sprint)
    return await TaskReader(session)._filter_context(
        generate_id(), generate_id(), PROJECT_ID, FIELDS, request_zone, now
    )


async def test_today_is_the_calendar_day_of_the_profile_zone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Half past midnight on the 24th in Auckland is still the 23rd in UTC.
    now = datetime(2026, 9, 23, 12, 30, tzinfo=UTC)
    ctx = await _context(monkeypatch, "Pacific/Auckland", "Europe/Sofia", now)
    assert ctx.today == date(2026, 9, 24)
    assert ctx.week_start == 6


async def test_the_client_zone_applies_when_the_profile_names_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 9, 23, 6, 30, tzinfo=UTC)
    ctx = await _context(monkeypatch, None, "America/Los_Angeles", now)
    assert ctx.today == date(2026, 9, 22)
    assert (await _context(monkeypatch, None, None, now)).zone == ZoneInfo("UTC")


async def test_an_unknown_client_zone_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError):
        await _context(monkeypatch, None, "Mars/Olympus", datetime.now(UTC))


async def test_a_stored_zone_this_server_does_not_know_falls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 9, 23, 6, 30, tzinfo=UTC)
    ctx = await _context(monkeypatch, "Mars/Olympus", "America/Los_Angeles", now)
    assert ctx.today == date(2026, 9, 22)


def _condition(ref: TaskFieldRef, operator: int, value: TaskFilterValue) -> TaskFilterNode:
    return TaskFilterNode(condition=TaskFilterCondition(field=ref, operator=operator, value=value))


def _depth_is(depth: int) -> TaskFilterGroup:
    return TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND,
        nodes=[
            _condition(
                TaskFieldRef(pseudo=TaskPseudoField.TASK_PSEUDO_FIELD_DEPTH),
                TaskFilterOperator.TASK_FILTER_OPERATOR_IS,
                TaskFilterValue(number=depth),
            )
        ],
    )


def test_a_depth_filter_and_a_depth_sort_share_one_ancestry() -> None:
    compiler = TaskFilterCompiler(CTX)
    query = select(Task).where(compiler.compile(_depth_is(1)))
    by_depth = [TaskSort(field=TaskFieldRef(pseudo=TaskPseudoField.TASK_PSEUDO_FIELD_DEPTH))]
    sql = _compiles(apply_task_sort(query, by_depth, compiler))
    assert sql.count("RECURSIVE task_ancestry(") == 1


def _on_gone_field() -> TaskFilterGroup:
    return TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_OR,
        nodes=[
            _condition(
                TaskFieldRef(field_id="gone"),
                TaskFilterOperator.TASK_FILTER_OPERATOR_IS_NONE_OF,
                TaskFilterValue(ids=TaskFilterIdSet(ids=["x"])),
            )
        ],
    )


def test_a_stored_view_on_a_deleted_field_matches_nothing() -> None:
    with pytest.raises(ValidationError, match="gone"):
        validate_task_filter(_on_gone_field(), FIELDS)
    group = validate_task_filter(_on_gone_field(), FIELDS, stored=True)
    assert _compiles(select(Task.id).where(compile_task_filter(group, CTX))).endswith("WHERE false")


def test_a_stored_sort_drops_keys_on_deleted_fields() -> None:
    keys = [
        TaskSort(field=TaskFieldRef(field_id="gone"), direction=SortDirection.SORT_DIRECTION_ASC),
        TaskSort(field=TaskFieldRef(field_id="points"), direction=SortDirection.SORT_DIRECTION_ASC),
    ]
    with pytest.raises(ValidationError, match="gone"):
        validate_task_sort(keys, FIELDS)
    assert [key.field.field_id for key in validate_task_sort(keys, FIELDS, stored=True)] == [
        "points"
    ]


def test_an_id_in_capitals_names_the_same_row() -> None:
    person = str(IDS["user-other"])
    group = TaskFilterGroup(
        logic=FilterLogic.FILTER_LOGIC_AND,
        nodes=[
            _condition(
                TaskFieldRef(field_id="field_assignee"),
                TaskFilterOperator.TASK_FILTER_OPERATOR_IS_ANY_OF,
                TaskFilterValue(ids=TaskFilterIdSet(ids=[person.upper()])),
            )
        ],
    )
    compiled = (
        select(Task.id).where(compile_task_filter(group, CTX)).compile(dialect=postgresql.dialect())
    )
    assert [person] in compiled.params.values()
