"""Task export rows: column order, labels, the custom field union and cell safety."""

import csv
import io
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.types import generate_id
from uniffy.domains.projects.export.labels import ExportLabels
from uniffy.domains.projects.export.rows import (
    CHUNK_FLUSH_BYTES,
    CSV_BOM,
    TASK_COLUMNS,
    CsvChunker,
    build_custom_columns,
    format_number,
    safe_text,
    task_row,
)

ORG = generate_id()


def _project(name: str, slug: str) -> Project:
    return Project(id=generate_id(), organization_id=ORG, owner_id=generate_id(), name=name, slug=slug)


def _field(project: Project, field_id: str, name: str, field_type: ProjectFieldType, **kw):
    return FieldDefinition(
        id=field_id,
        project_id=project.id,
        name=name,
        type=field_type,
        is_system=kw.pop("is_system", False),
        sort_order=kw.pop("sort_order", 10),
        config=kw.pop("config", {}),
    )


def _status_field(project: Project) -> FieldDefinition:
    return _field(
        project,
        "field_status",
        "Status",
        ProjectFieldType.SINGLE_SELECT,
        is_system=True,
        sort_order=1,
        config={
            "options": [
                {"id": "status_todo", "label": "To Do"},
                {"id": "status_in_progress", "label": "In Progress"},
            ]
        },
    )


def _priority_field(project: Project) -> FieldDefinition:
    return _field(
        project,
        "field_priority",
        "Priority",
        ProjectFieldType.SINGLE_SELECT,
        is_system=True,
        sort_order=2,
        config={"options": [{"id": "priority_high", "label": "High"}]},
    )


class _Labels(ExportLabels):
    """Labels with the lookups a database would have answered filled in by hand."""

    def __init__(self, projects: list[Project], fields: dict[UUID, list[FieldDefinition]]) -> None:
        super().__init__(MagicMock(), organization_id=ORG, user_id=generate_id())
        self._slugs = {project.id: project.slug for project in projects}
        for project_id, project_fields in fields.items():
            self._fields[project_id] = {field.id: field for field in project_fields}
            for field in project_fields:
                self._options[(project_id, field.id)] = {
                    option["id"]: option["label"]
                    for option in (field.config or {}).get("options", [])
                }


def _task(project: Project, number: int, **kw) -> Task:
    return Task(
        id=kw.pop("id", generate_id()),
        project_id=project.id,
        organization_id=ORG,
        owner_id=kw.pop("owner_id", generate_id()),
        title=kw.pop("title", f"Task {number}"),
        number=number,
        created_at=datetime(2026, 9, 1, 8, 30, tzinfo=UTC),
        updated_at=datetime(2026, 9, 2, 9, 0, tzinfo=UTC),
        **kw,
    )


def _cell(row: list[str], column: str) -> str:
    return row[TASK_COLUMNS.index(column)]


def test_fixed_columns_follow_the_documented_order() -> None:
    assert TASK_COLUMNS == (
        "project",
        "project_slug",
        "key",
        "title",
        "type",
        "status",
        "priority",
        "assignees",
        "creator_email",
        "start_date",
        "due_date",
        "completed_at",
        "estimated_minutes",
        "time_spent_minutes",
        "sprint",
        "parent_key",
        "depth",
        "is_milestone",
        "blocked_by_keys",
        "tags",
        "created_at",
        "updated_at",
        "description",
    )


def test_status_and_priority_export_option_labels_not_ids() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: [_status_field(project), _priority_field(project)]})
    task = _task(project, 7, status="status_in_progress", priority="priority_high")

    row = task_row(task, project, labels, [])

    assert _cell(row, "status") == "In Progress"
    assert _cell(row, "priority") == "High"
    assert _cell(row, "key") == "ALP-7"


def test_an_option_that_no_longer_exists_exports_its_id() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: [_status_field(project)]})

    row = task_row(_task(project, 1, status="status_gone"), project, labels, [])

    assert _cell(row, "status") == "status_gone"


def test_assignees_are_emails_for_people_and_names_for_groups() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: []})
    person, group, owner, stranger = generate_id(), generate_id(), generate_id(), generate_id()
    labels._emails = {person: "ann@example.com", owner: "owner@example.com"}
    labels._names = {group: "Platform team"}
    task = _task(
        project,
        1,
        owner_id=owner,
        assignee_ids=[str(person), str(group), str(stranger)],
    )

    row = task_row(task, project, labels, [])

    assert _cell(row, "assignees") == f"ann@example.com;Platform team;{stranger}"
    assert _cell(row, "creator_email") == "owner@example.com"


def test_a_subtask_carries_its_parent_key_and_depth() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: []})
    parent = _task(project, 1)
    child = _task(project, 2, parent_id=parent.id)
    labels._keys = {parent.id: "ALP-1"}
    labels._depths = {parent.id: 0, child.id: 1}

    root_row = task_row(parent, project, labels, [])
    child_row = task_row(child, project, labels, [])

    assert (_cell(root_row, "parent_key"), _cell(root_row, "depth")) == ("", "0")
    assert (_cell(child_row, "parent_key"), _cell(child_row, "depth")) == ("ALP-1", "1")


def test_sprint_tags_blockers_and_timestamps() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: []})
    sprint = Sprint(id=generate_id(), project_id=project.id, organization_id=ORG, name="Sprint 4")
    labels._sprints = {sprint.id: sprint}
    blocker = generate_id()
    task = _task(project, 3, sprint_id=sprint.id, blocked_by_task_ids=[str(blocker), "junk"])
    labels._keys = {blocker: "ALP-9"}
    labels._tags = {task.id: ["red", "blue"]}

    row = task_row(task, project, labels, [])

    assert _cell(row, "sprint") == "Sprint 4"
    assert _cell(row, "blocked_by_keys") == "ALP-9"
    assert _cell(row, "tags") == "red;blue"
    assert _cell(row, "created_at") == "2026-09-01T08:30:00+00:00"
    assert _cell(row, "is_milestone") == "false"


def test_custom_columns_union_across_projects_and_stay_blank_where_undefined() -> None:
    first, second = _project("Alpha", "ALP"), _project("Beta", "BET")
    points = _field(first, "f_points", "Points", ProjectFieldType.NUMBER)
    fields = {first.id: [_status_field(first), points], second.id: [_status_field(second)]}
    columns = build_custom_columns([first, second], fields)
    labels = _Labels([first, second], fields)

    first_row = task_row(_task(first, 1, field_values={"f_points": 5.0}), first, labels, columns)
    second_row = task_row(_task(second, 1, field_values={}), second, labels, columns)

    assert [column.header for column in columns] == ["field:Points"]
    assert first_row[-1] == "5"
    assert second_row[-1] == ""


def test_custom_columns_merge_names_case_insensitively_and_number_duplicates() -> None:
    first, second = _project("Alpha", "ALP"), _project("Beta", "BET")
    fields = {
        first.id: [
            _field(first, "a1", "Risk", ProjectFieldType.TEXT, sort_order=1),
            _field(first, "a2", "Risk", ProjectFieldType.TEXT, sort_order=2),
        ],
        second.id: [_field(second, "b1", "risk ", ProjectFieldType.TEXT)],
    }

    columns = build_custom_columns([first, second], fields)

    assert [column.header for column in columns] == ["field:Risk", "field:Risk (2)"]
    assert columns[0].field_ids == {first.id: "a1", second.id: "b1"}
    assert columns[1].field_ids == {first.id: "a2"}


def test_custom_field_values_export_labels_people_dates_and_references() -> None:
    project = _project("Alpha", "ALP")
    person = generate_id()
    fields = [
        _field(
            project,
            "env",
            "Environments",
            ProjectFieldType.MULTI_SELECT,
            sort_order=1,
            config={"options": [{"id": "o1", "label": "Prod"}, {"id": "o2", "label": "Staging"}]},
        ),
        _field(project, "owner", "Owner", ProjectFieldType.PERSON, sort_order=2),
        _field(project, "when", "When", ProjectFieldType.DATE, sort_order=3),
        _field(project, "doc", "Doc", ProjectFieldType.REFERENCE, sort_order=4),
    ]
    columns = build_custom_columns([project], {project.id: fields})
    labels = _Labels([project], {project.id: fields})
    labels._emails = {person: "ann@example.com"}
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"
    values = {"env": ["o1", "o2"], "owner": [str(person)], "when": "2026-10-01", "doc": urn}

    row = task_row(_task(project, 1, field_values=values), project, labels, columns)

    assert row[-4:] == ["Prod;Staging", "ann@example.com", "2026-10-01", urn]


@pytest.mark.parametrize("names", [("Risk", "Risk", "Risk (2)"), ("Risk (2)", "Risk", "Risk")])
def test_literal_suffixes_cannot_overwrite_duplicate_field_values(names: tuple[str, ...]) -> None:
    first, second = _project("Alpha", "ALP"), _project("Beta", "BET")
    fields = {
        first.id: [
            _field(first, f"f{index}", name, ProjectFieldType.TEXT, sort_order=index)
            for index, name in enumerate(names)
        ],
        second.id: [_field(second, "b1", "risk (2)", ProjectFieldType.TEXT)],
    }
    columns = build_custom_columns([first, second], fields)
    labels = _Labels([first, second], fields)
    values = {f"f{index}": f"value{index}" for index in range(len(names))}

    row = task_row(_task(first, 1, field_values=values), first, labels, columns)
    other = task_row(_task(second, 1, field_values={"b1": "literal"}), second, labels, columns)

    assert len(columns) == 3
    assert len({column.header.casefold() for column in columns}) == 3
    assert row[-3:] == ["value0", "value1", "value2"]
    literal_index = next(i for i, column in enumerate(columns) if column.header == "field:Risk (2)")
    assert other[len(TASK_COLUMNS) + literal_index] == "literal"


def test_task_types_dates_and_emails_are_safe_in_serialized_csv() -> None:
    project = _project("Alpha", "ALP")
    labels = _Labels([project], {project.id: []})
    task = _task(project, 1, task_type="=1+1", start_date="=2+2", due_date="+3+3")
    labels._emails[task.owner_id] = "=formula@example.com"
    chunker = CsvChunker()
    chunker.header(TASK_COLUMNS)
    chunker.row(task_row(task, project, labels, []))
    payload = chunker.flush()
    assert payload is not None

    row = next(csv.DictReader(io.StringIO(payload.decode("utf-8-sig"))))

    assert row["type"] == "'=1+1"
    assert row["start_date"] == "'=2+2"
    assert row["due_date"] == "'+3+3"
    assert row["creator_email"] == "'=formula@example.com"


def test_text_that_a_spreadsheet_would_run_as_a_formula_is_defused() -> None:
    for raw in ("=SUM(A1:A9)", "+1", "-cmd", "@SUM(1)", "\tx", "\rx"):
        assert safe_text(raw) == f"'{raw}"
    assert safe_text("Fix login") == "Fix login"
    assert safe_text(None) == ""


def test_a_formula_like_title_is_defused_in_the_row() -> None:
    project = _project("=Evil", "ALP")
    labels = _Labels([project], {project.id: []})

    row = task_row(_task(project, 1, title="=HYPERLINK(\"x\")"), project, labels, [])

    assert _cell(row, "project") == "'=Evil"
    assert _cell(row, "title") == "'=HYPERLINK(\"x\")"


def test_numbers_drop_an_integral_fraction_and_keep_others() -> None:
    assert format_number(5.0) == "5"
    assert format_number(2.5) == "2.5"
    assert format_number(-3) == "-3"
    assert format_number(None) == ""
    assert format_number(True) == ""


def test_the_chunker_opens_with_a_bom_and_flushes_in_bounded_chunks() -> None:
    chunker = CsvChunker()
    chunks = [chunker.header(["a", "b"])]
    for index in range(5_000):
        chunks.append(chunker.row([str(index), "x" * 20]))
    chunks.append(chunker.flush())
    produced = [chunk for chunk in chunks if chunk]

    text = b"".join(produced).decode("utf-8")
    rows = list(csv.reader(io.StringIO(text.removeprefix(CSV_BOM))))

    assert len(produced) > 1
    assert text.startswith(CSV_BOM) and text.count(CSV_BOM) == 1
    assert "\r\n" in text
    assert all(len(chunk) < CHUNK_FLUSH_BYTES + 200 for chunk in produced)
    assert rows[0] == ["a", "b"] and len(rows) == 5_001
