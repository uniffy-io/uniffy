"""Saved view definition validation, normalization and storage."""

import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from protobuf import Oneof
from uniffy_proto.projects.v1.projects_pb import (
    BacklogLayout,
    BoardLayout,
    ColumnWidth,
    FilterLogic,
    GraphLayout,
    RelativeDate,
    RelativeDateAnchor,
    ResourcesLayout,
    RoadmapLayout,
    RoadmapZoom,
    SortDirection,
    TableLayout,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterDateRange,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterNode,
    TaskFilterNumberRange,
    TaskFilterOperator,
    TaskFilterValue,
    TaskGroupBy,
    TaskPseudoField,
    TaskSort,
    ViewDefinition,
)

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.view_config import ProjectViewType
from uniffy.domains.projects.defaults import default_view_definitions
from uniffy.domains.projects.views.definition import (
    MAX_FILTER_NODES,
    definition_from_dict,
    definition_to_dict,
    normalize_definition,
    prepare_definition,
    validate_definition,
    validate_view_name,
    view_type_for,
)

Op = TaskFilterOperator
PROJECT_ID = uuid4()


def _field(field_id: str, name: str, field_type: ProjectFieldType, config=None) -> FieldDefinition:
    return FieldDefinition(
        id=field_id, project_id=PROJECT_ID, name=name, type=field_type, config=config or {}
    )


FIELDS = [
    _field("field_title", "Title", ProjectFieldType.TEXT),
    _field(
        "field_status",
        "Status",
        ProjectFieldType.SINGLE_SELECT,
        {"options": [{"id": "status_todo"}, {"id": "status_done"}]},
    ),
    _field(
        "field_priority",
        "Priority",
        ProjectFieldType.SINGLE_SELECT,
        {"options": [{"id": "priority_low"}, {"id": "priority_high"}]},
    ),
    _field("field_assignee", "Assignee", ProjectFieldType.PERSON),
    _field("field_start_date", "Start Date", ProjectFieldType.DATE),
    _field("field_due_date", "Due Date", ProjectFieldType.DATE),
    _field("field_points", "Points", ProjectFieldType.NUMBER),
    _field(
        "field_labels",
        "Labels",
        ProjectFieldType.MULTI_SELECT,
        {"options": [{"id": "ui"}, {"id": "api"}]},
    ),
    _field("field_link", "Link", ProjectFieldType.REFERENCE),
]


def ref(field_id: str) -> TaskFieldRef:
    return TaskFieldRef(ref=Oneof(field="field_id", value=field_id))


def pseudo(value: TaskPseudoField) -> TaskFieldRef:
    return TaskFieldRef(ref=Oneof(field="pseudo", value=value))


def ids(*values: str, **flags: bool) -> TaskFilterValue:
    return TaskFilterValue(
        value=Oneof(field="ids", value=TaskFilterIdSet(ids=list(values), **flags))
    )


def condition(field: TaskFieldRef, operator, value: TaskFilterValue | None = None):
    return TaskFilterNode(
        node=Oneof(
            field="condition", value=TaskFilterCondition(field=field, operator=operator, value=value)
        )
    )


def table(*nodes: TaskFilterNode, logic=FilterLogic.AND, **extra) -> ViewDefinition:
    return ViewDefinition(
        layout=Oneof(field="table", value=TableLayout()),
        filter=TaskFilterGroup(logic=logic, nodes=list(nodes)),
        **extra,
    )


def check(definition: ViewDefinition) -> None:
    validate_definition(normalize_definition(definition), FIELDS)


def rejects(definition: ViewDefinition, fragment: str) -> None:
    with pytest.raises(ValidationError) as exc:
        check(definition)
    assert fragment in exc.value.message


def full_definition() -> ViewDefinition:
    user_id = str(uuid4())
    return ViewDefinition(
        layout=Oneof(field="board", value=BoardLayout(column_field_id="field_priority")),
        filter=TaskFilterGroup(
            logic=FilterLogic.AND,
            nodes=[
                condition(ref("field_status"), Op.IS_ANY_OF, ids("status_todo")),
                TaskFilterNode(
                    node=Oneof(
                        field="group",
                        value=TaskFilterGroup(
                            logic=FilterLogic.OR,
                            nodes=[
                                condition(
                                    ref("field_assignee"),
                                    Op.IS_ANY_OF,
                                    ids(user_id, include_current_user=True),
                                ),
                                condition(ref("field_assignee"), Op.IS_EMPTY),
                            ],
                        ),
                    )
                ),
                condition(
                    ref("field_due_date"),
                    Op.ON_OR_BEFORE,
                    TaskFilterValue(
                        value=Oneof(
                            field="date",
                            value=TaskFilterDate(
                                value=Oneof(
                                    field="relative",
                                    value=RelativeDate(anchor=RelativeDateAnchor.END_OF_WEEK),
                                )
                            ),
                        )
                    ),
                ),
                condition(
                    ref("field_points"),
                    Op.BETWEEN,
                    TaskFilterValue(
                        value=Oneof(field="number_range", value=TaskFilterNumberRange(min=1, max=8))
                    ),
                ),
                condition(
                    pseudo(TaskPseudoField.IS_BLOCKED),
                    Op.IS,
                    TaskFilterValue(value=Oneof(field="flag", value=True)),
                ),
                condition(
                    pseudo(TaskPseudoField.SPRINT),
                    Op.IS_ANY_OF,
                    ids(include_active_sprint=True, include_empty=True),
                ),
                condition(
                    ref("field_title"),
                    Op.CONTAINS,
                    TaskFilterValue(value=Oneof(field="text", value="login")),
                ),
            ],
        ),
        sort=[
            TaskSort(field=ref("field_due_date"), direction=SortDirection.ASC),
            TaskSort(
                field=pseudo(TaskPseudoField.CREATED_AT),
                direction=SortDirection.DESC,
            ),
        ],
        group_by=TaskGroupBy(
            field=pseudo(TaskPseudoField.TAGS),
            direction=SortDirection.ASC,
            hide_empty=True,
        ),
        visible_fields=[ref("field_title"), pseudo(TaskPseudoField.NUMBER)],
        column_widths=[ColumnWidth(field=ref("field_title"), width=320)],
        collapsed_group_keys=["none"],
    )


def test_full_definition_is_valid_and_round_trips_through_storage() -> None:
    definition = full_definition()
    check(definition)

    stored = definition_to_dict(definition)
    assert definition_from_dict(stored, ProjectViewType.BOARD) == definition


@pytest.mark.parametrize(
    ("definition", "view_type"),
    [
        (ViewDefinition(layout=Oneof(field="table", value=TableLayout())), ProjectViewType.TABLE),
        (ViewDefinition(layout=Oneof(field="board", value=BoardLayout())), ProjectViewType.BOARD),
        (
            ViewDefinition(layout=Oneof(field="roadmap", value=RoadmapLayout())),
            ProjectViewType.ROADMAP,
        ),
        (
            ViewDefinition(layout=Oneof(field="backlog", value=BacklogLayout())),
            ProjectViewType.BACKLOG,
        ),
        (ViewDefinition(layout=Oneof(field="graph", value=GraphLayout())), ProjectViewType.GRAPH),
        (
            ViewDefinition(layout=Oneof(field="resources", value=ResourcesLayout())),
            ProjectViewType.RESOURCES,
        ),
    ],
)
def test_each_layout_maps_to_its_view_type(definition, view_type) -> None:
    assert prepare_definition(definition, FIELDS)[1] is view_type


def test_rejects_a_definition_without_layout() -> None:
    with pytest.raises(ValidationError):
        view_type_for(ViewDefinition())


def test_empty_layouts_survive_storage() -> None:
    stored = definition_to_dict(ViewDefinition(layout=Oneof(field="backlog", value=BacklogLayout())))
    assert stored == {"backlog": {}}
    assert definition_from_dict(stored, ProjectViewType.BACKLOG).has_field("backlog")


def test_rejects_unknown_field_and_names_it() -> None:
    rejects(
        table(condition(ref("field_gone"), Op.IS_EMPTY)),
        "unknown field 'field_gone'",
    )


def test_rejects_a_definition_whose_field_was_deleted_after_it_was_saved() -> None:
    definition = normalize_definition(
        table(
            condition(ref("field_title"), Op.IS_NOT_EMPTY),
            condition(
                ref("field_points"),
                Op.GREATER_THAN,
                TaskFilterValue(value=Oneof(field="number", value=3)),
            ),
        )
    )
    validate_definition(definition, FIELDS)

    with pytest.raises(ValidationError) as exc:
        validate_definition(definition, [f for f in FIELDS if f.id != "field_points"])
    assert exc.value.message == "Filter condition 2: unknown field 'field_points'"


def test_rejects_unset_and_unspecified_field_refs() -> None:
    rejects(table(condition(TaskFieldRef(), Op.IS_EMPTY)), "field is required")
    rejects(
        table(
            condition(
                pseudo(TaskPseudoField.UNSPECIFIED),
                Op.IS_EMPTY,
            )
        ),
        "unknown task attribute",
    )


@pytest.mark.parametrize(
    "value",
    [value for value in TaskPseudoField if value],
)
def test_every_task_attribute_resolves(value) -> None:
    check(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()), visible_fields=[pseudo(value)]
        )
    )


def test_rejects_operator_the_field_does_not_support() -> None:
    rejects(
        table(condition(ref("field_status"), Op.CONTAINS, ids("status_todo"))),
        "'Status (field_status)' does not support 'contains'",
    )


def test_rejects_emptiness_checks_on_attributes_that_are_never_empty() -> None:
    rejects(
        table(condition(pseudo(TaskPseudoField.CREATOR), Op.IS_EMPTY)),
        "does not support 'is empty'",
    )


def test_rejects_value_on_emptiness_check() -> None:
    rejects(
        table(condition(ref("field_status"), Op.IS_EMPTY, ids("status_todo"))),
        "takes no value",
    )


def test_rejects_missing_value() -> None:
    rejects(table(condition(ref("field_status"), Op.IS)), "needs a value")


def test_rejects_two_values_for_is() -> None:
    rejects(
        table(condition(ref("field_status"), Op.IS, ids("status_todo", "status_done"))),
        "exactly one value",
    )


def test_current_user_alone_is_a_value_for_people_only() -> None:
    check(
        table(
            condition(
                ref("field_assignee"),
                Op.IS_ANY_OF,
                ids(include_current_user=True),
            )
        )
    )
    rejects(
        table(
            condition(
                ref("field_status"),
                Op.IS_ANY_OF,
                ids(include_current_user=True),
            )
        ),
        "does not accept the current user",
    )


def test_active_sprint_is_a_value_for_the_sprint_only() -> None:
    rejects(
        table(
            condition(
                ref("field_assignee"),
                Op.IS_ANY_OF,
                ids(include_active_sprint=True),
            )
        ),
        "does not accept the active sprint",
    )


def test_rejects_empty_value_among_all_of() -> None:
    rejects(
        table(
            condition(
                ref("field_labels"),
                Op.IS_ALL_OF,
                ids("ui", include_empty=True),
            )
        ),
        "cannot require an empty value",
    )


def test_rejects_unknown_option_task_type_and_malformed_ids() -> None:
    rejects(
        table(condition(ref("field_status"), Op.IS, ids("status_gone"))),
        "has no option 'status_gone'",
    )
    rejects(
        table(
            condition(
                pseudo(TaskPseudoField.TASK_TYPE),
                Op.IS,
                ids("chore"),
            )
        ),
        "'chore' is not a task type",
    )
    rejects(
        table(condition(ref("field_assignee"), Op.IS, ids("alice"))),
        "invalid id 'alice'",
    )


def test_rejects_duplicate_ids() -> None:
    rejects(
        table(condition(ref("field_labels"), Op.IS_ANY_OF, ids("ui", "ui"))),
        "lists a value twice",
    )


def test_rejects_inverted_number_range() -> None:
    rejects(
        table(
            condition(
                ref("field_points"),
                Op.BETWEEN,
                TaskFilterValue(
                    value=Oneof(field="number_range", value=TaskFilterNumberRange(min=5, max=1))
                ),
            )
        ),
        "start is not after its end",
    )


def test_rejects_inverted_and_impossible_dates() -> None:
    def fixed(value: str) -> TaskFilterDate:
        return TaskFilterDate(value=Oneof(field="fixed", value=value))

    rejects(
        table(
            condition(
                ref("field_due_date"),
                Op.BETWEEN,
                TaskFilterValue(
                    value=Oneof(
                        field="date_range",
                        value=TaskFilterDateRange(
                            start=fixed("2026-09-20"), end=fixed("2026-09-01")
                        ),
                    )
                ),
            )
        ),
        "start is not after its end",
    )
    rejects(
        table(
            condition(
                ref("field_due_date"),
                Op.BEFORE,
                TaskFilterValue(value=Oneof(field="date", value=fixed("2026-02-30"))),
            )
        ),
        "is not a calendar date",
    )
    rejects(
        table(
            condition(
                ref("field_due_date"),
                Op.BEFORE,
                TaskFilterValue(
                    value=Oneof(
                        field="date",
                        value=TaskFilterDate(value=Oneof(field="relative", value=RelativeDate())),
                    )
                ),
            )
        ),
        "without an anchor",
    )


def test_rejects_text_value_on_number_field() -> None:
    rejects(
        table(
            condition(
                ref("field_points"),
                Op.GREATER_THAN,
                TaskFilterValue(value=Oneof(field="text", value="3")),
            )
        ),
        "needs a number",
    )


def test_reference_fields_only_check_emptiness() -> None:
    check(table(condition(ref("field_link"), Op.IS_NOT_EMPTY)))
    rejects(
        table(condition(ref("field_link"), Op.IS, ids("urn:uniffy:x"))),
        "does not support 'is'",
    )


def _nested(depth: int) -> TaskFilterGroup:
    group = TaskFilterGroup(nodes=[condition(ref("field_title"), Op.IS_NOT_EMPTY)])
    for _ in range(depth - 1):
        group = TaskFilterGroup(nodes=[TaskFilterNode(node=Oneof(field="group", value=group))])
    return group


def test_filter_nests_three_levels_and_no_deeper() -> None:
    check(ViewDefinition(layout=Oneof(field="table", value=TableLayout()), filter=_nested(3)))
    rejects(
        ViewDefinition(layout=Oneof(field="table", value=TableLayout()), filter=_nested(4)),
        "at most 3 levels",
    )


def test_filter_holds_a_bounded_number_of_nodes() -> None:
    node = condition(ref("field_title"), Op.IS_NOT_EMPTY)
    check(table(*[node] * MAX_FILTER_NODES))
    rejects(table(*[node] * (MAX_FILTER_NODES + 1)), "at most 50 conditions")


def test_sort_keys_are_bounded_unique_and_sortable() -> None:
    fields = ["field_title", "field_status", "field_priority", "field_start_date", "field_due_date"]
    check(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            sort=[TaskSort(field=ref(f)) for f in fields],
        )
    )
    rejects(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            sort=[TaskSort(field=ref(f)) for f in [*fields, "field_points"]],
        ),
        "at most 5 fields",
    )
    rejects(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            sort=[TaskSort(field=ref("field_title")), TaskSort(field=ref("field_title"))],
        ),
        "already a sort key",
    )
    rejects(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            sort=[TaskSort(field=pseudo(TaskPseudoField.TAGS))],
        ),
        "cannot sort by 'tags'",
    )


def test_group_by_needs_a_groupable_field() -> None:
    rejects(
        ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            group_by=TaskGroupBy(field=ref("field_title")),
        ),
        "cannot group by 'Title (field_title)'",
    )


def test_column_widths_stay_in_range() -> None:
    for width in (39, 2001):
        rejects(
            ViewDefinition(
                layout=Oneof(field="table", value=TableLayout()),
                column_widths=[ColumnWidth(field=ref("field_title"), width=width)],
            ),
            "between 40 and 2000",
        )


def test_board_columns_need_a_single_select_field() -> None:
    rejects(
        ViewDefinition(
            layout=Oneof(field="board", value=BoardLayout(column_field_id="field_due_date"))
        ),
        "single-select field",
    )


def test_normalization_fills_documented_defaults() -> None:
    normalized = normalize_definition(
        ViewDefinition(
            layout=Oneof(field="roadmap", value=RoadmapLayout()),
            filter=TaskFilterGroup(
                nodes=[TaskFilterNode(node=Oneof(field="group", value=TaskFilterGroup()))]
            ),
            sort=[TaskSort(field=ref("field_title"))],
            group_by=TaskGroupBy(field=ref("field_status")),
        )
    )

    assert normalized.layout.value.zoom == RoadmapZoom.WEEK
    assert normalized.filter.logic == FilterLogic.AND
    assert normalized.filter.nodes[0].node.value.logic == FilterLogic.AND
    assert normalized.sort[0].direction == SortDirection.ASC
    assert normalized.group_by.direction == SortDirection.ASC


def test_normalization_does_not_invent_a_filter() -> None:
    assert not normalize_definition(
        ViewDefinition(layout=Oneof(field="table", value=TableLayout()))
    ).has_field("filter")


def test_stored_definition_that_no_longer_parses_keeps_its_layout() -> None:
    unknown_enum = {"roadmap": {"zoom": "ROADMAP_ZOOM_DECADE"}}
    unknown_key = {"board": {}, "swimlanes": True}
    no_layout: dict = {}

    assert definition_from_dict(unknown_enum, ProjectViewType.ROADMAP).has_field("roadmap")
    assert definition_from_dict(unknown_key, ProjectViewType.BOARD).has_field("board")
    assert definition_from_dict(no_layout, ProjectViewType.GRAPH).has_field("graph")


def test_view_names_are_trimmed_and_bounded() -> None:
    assert validate_view_name("  My bugs ") == "My bugs"
    with pytest.raises(ValidationError):
        validate_view_name("   ")
    with pytest.raises(ValidationError):
        validate_view_name("x" * 101)


def test_default_views_are_valid_against_default_fields() -> None:
    for _, _, definition in default_view_definitions():
        check(definition)


def test_migration_seed_matches_application_defaults() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations"
        / "versions"
        / "106_project_view_ownership.py"
    )
    spec = importlib.util.spec_from_file_location("project_view_ownership", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    expected = {
        view_id.value: (name, view_type_for(definition).value, definition_to_dict(definition))
        for view_id, name, definition in default_view_definitions()
    }
    assert expected == migration.SEED_VIEWS
    assert list(migration.SEED_VIEWS) == list(expected)


@pytest.mark.parametrize(
    "definition",
    [
        table(condition(None, Op.IS_EMPTY)),
        table(sort=[TaskSort()]),
        table(group_by=TaskGroupBy()),
        table(column_widths=[ColumnWidth(width=100)]),
        table(
            condition(
                ref("field_due_date"),
                Op.BETWEEN,
                TaskFilterValue(value=Oneof(field="date_range", value=TaskFilterDateRange())),
            )
        ),
    ],
)
def test_missing_nested_fields_raise_validation_errors(definition: ViewDefinition) -> None:
    with pytest.raises(ValidationError):
        validate_definition(normalize_definition(definition), FIELDS)


def test_normalization_does_not_mutate_shared_input() -> None:
    definition = table(condition(ref("field_title"), Op.IS_NOT_EMPTY))
    original = definition.to_binary()
    normalized = normalize_definition(definition)
    normalized.filter.nodes.clear()
    assert definition.to_binary() == original
    assert len(definition.filter.nodes) == 1
