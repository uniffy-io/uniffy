from uuid import uuid4

import pytest
from uniffy_proto.settings.v1.dashboard_pb import (
    DashboardDefinition,
    DashboardPeopleScope,
    DashboardProjectScope,
    DashboardWidget,
    DashboardWidgetFilters,
)

from uniffy.core.errors import ValidationError
from uniffy.domains.projects.metrics.scope import PeopleScope, ProjectScope, SprintScope
from uniffy.domains.settings.dashboard.definition import (
    Definition,
    Widget,
    WidgetFilters,
    load_catalog,
    parse_stored,
    validate_for_save,
)
from uniffy.domains.settings.dashboard.handlers import definition_from_proto, definition_to_proto

CATALOG = load_catalog()


def test_catalog_presets_and_default_only_use_known_widgets() -> None:
    known = {widget.widget_id for widget in CATALOG.widgets}
    assert {preset.preset_id for preset in CATALOG.presets} == {"lead", "pm", "developer", "qa"}
    for definition in [CATALOG.default, *(preset.definition for preset in CATALOG.presets)]:
        assert {widget.widget_id for widget in definition.widgets} <= known
        assert validate_for_save(definition, CATALOG).widgets


def test_default_shows_every_widget_and_templates_carry_their_label() -> None:
    assert {w.widget_id for w in CATALOG.default.widgets} == {t.widget_id for t in CATALOG.widgets}
    assert all(widget.visible for widget in CATALOG.default.widgets)
    assert CATALOG.default.name == ""
    for preset in CATALOG.presets:
        assert preset.definition.name == preset.label


def test_names_are_trimmed_kept_and_bounded() -> None:
    saved = validate_for_save(
        Definition(widgets=(Widget("my-time"),), name="  Sprint   review  "), CATALOG
    )
    assert saved.name == "Sprint review"
    assert parse_stored(saved.to_json(), CATALOG).name == "Sprint review"
    with pytest.raises(ValidationError):
        validate_for_save(Definition(widgets=(Widget("my-time"),), name="x" * 81), CATALOG)


def test_presets_store_relative_tokens_not_resolved_ids() -> None:
    lead = CATALOG.preset("lead")
    assert lead is not None
    workload = next(w for w in lead.definition.widgets if w.widget_id == "workload")
    assert workload.filters.people is PeopleScope.MY_TEAMS
    assert workload.filters.projects is ProjectScope.MY_PROJECTS
    assert workload.filters.project_ids == ()


def test_stored_round_trip_keeps_order_filters_and_preset() -> None:
    project_id = uuid4()
    definition = Definition(
        widgets=(
            Widget(
                "overdue-tasks",
                filters=WidgetFilters(
                    projects=ProjectScope.SELECTED,
                    project_ids=(project_id,),
                    people=PeopleScope.ME,
                    sprint=SprintScope.ACTIVE,
                ),
            ),
            Widget("today-agenda", visible=False),
        ),
        preset="qa",
        name="QA",
    )
    parsed = parse_stored(definition.to_json(), CATALOG)
    assert parsed == definition


def test_unknown_stored_filters_warn_instead_of_widening() -> None:
    stored = {
        "widgets": [
            {
                "id": "blocked-tasks",
                "filters": {"projects": "my_projects", "label": "urgent", "people": "my_squad"},
            }
        ]
    }
    parsed = parse_stored(stored, CATALOG)
    assert parsed is not None
    widget = parsed.widgets[0]
    assert set(widget.unsupported_filters) == {"label", "people"}
    assert widget.filters.projects is ProjectScope.MY_PROJECTS
    # Keeps its flag through a later save, so the warning does not silently disappear.
    assert parse_stored(parsed.to_json(), CATALOG).widgets[0].unsupported_filters == (
        widget.unsupported_filters
    )


def test_retired_and_duplicate_stored_widgets_drop() -> None:
    stored = {"widgets": [{"id": "retired-widget"}, {"id": "my-time"}, {"id": "my-time"}]}
    parsed = parse_stored(stored, CATALOG)
    assert parsed is not None
    assert [widget.widget_id for widget in parsed.widgets] == ["my-time"]


@pytest.mark.parametrize(
    "widgets",
    [
        (Widget("not-a-widget"),),
        (Widget("my-time"), Widget("my-time")),
        (Widget("my-time", filters=WidgetFilters(people=PeopleScope.ME)),),
        (Widget("overdue-tasks", filters=WidgetFilters(projects=ProjectScope.SELECTED)),),
        (),
    ],
)
def test_save_rejects_invalid_definitions(widgets: tuple[Widget, ...]) -> None:
    with pytest.raises(ValidationError):
        validate_for_save(Definition(widgets=widgets), CATALOG)


def test_save_drops_project_ids_unless_selected() -> None:
    definition = Definition(
        widgets=(
            Widget(
                "overdue-tasks",
                filters=WidgetFilters(projects=ProjectScope.ALL, project_ids=(uuid4(),)),
            ),
        )
    )
    saved = validate_for_save(definition, CATALOG)
    assert saved.widgets[0].filters.project_ids == ()


def test_proto_round_trip() -> None:
    project_id = str(uuid4())
    proto = DashboardDefinition(
        widgets=[
            DashboardWidget(
                widget_id="workload",
                visible=True,
                filters=DashboardWidgetFilters(
                    projects=DashboardProjectScope.SELECTED,
                    project_ids=[project_id],
                    people=DashboardPeopleScope.MY_TEAMS,
                ),
            )
        ],
        preset="lead",
        name="Team lead",
    )
    definition = definition_from_proto(proto)
    widget = definition.widgets[0]
    assert widget.filters.people is PeopleScope.MY_TEAMS
    assert widget.filters.sprint is SprintScope.ANY
    assert [str(p) for p in widget.filters.project_ids] == [project_id]
    back = definition_to_proto(definition)
    assert back.widgets[0].filters.project_ids == [project_id]
    assert back.preset == "lead"
    assert back.name == "Team lead"
