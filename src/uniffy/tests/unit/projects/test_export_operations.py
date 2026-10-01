"""Task export preparation: refusals before any read, the project gate and the row cap."""

import io
import zipfile
from unittest.mock import AsyncMock, MagicMock

import pytest
from protobuf import Oneof
from sqlalchemy import select, true
from uniffy_proto.projects.v1.projects_pb import (
    SortDirection,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterGroup,
    TaskFilterNode,
    TaskFilterOperator,
    TaskSort,
)

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.types import generate_id
from uniffy.domains.projects.export.bundle import _activity_value, _ZipSink
from uniffy.domains.projects.export.labels import ExportLabels
from uniffy.domains.projects.export.operations import ProjectExportOperations
from uniffy.domains.projects.export.plan import ExportLayout, ExportRequest, ExportScope
from uniffy.domains.projects.export.rows import MAX_EXPORT_PROJECTS, MAX_EXPORT_ROWS
from uniffy.domains.projects.tasks.reader import TaskReader

ORG = generate_id()
USER = generate_id()


def _session() -> MagicMock:
    session = MagicMock()
    session.connection = AsyncMock()
    session.execute = AsyncMock()
    return session


def _projects_result(projects: list[Project]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value.all.return_value = projects
    return result


def _count_result(count: int) -> MagicMock:
    result = MagicMock()
    result.scalar_one.return_value = count
    return result


def _project(name: str) -> Project:
    return Project(id=generate_id(), organization_id=ORG, owner_id=USER, name=name, slug="P")


def _a_filter() -> TaskFilterGroup:
    return TaskFilterGroup(
        nodes=[
            TaskFilterNode(
                node=Oneof(
                    field="condition",
                    value=TaskFilterCondition(
                        field=TaskFieldRef(ref=Oneof(field="field_id", value="field_status")),
                        operator=TaskFilterOperator.IS_EMPTY,
                    ),
                )
            )
        ]
    )


@pytest.fixture
def open_access(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ContentAccessQuery, "build_accessible_filter", AsyncMock(return_value=true())
    )
    monkeypatch.setattr(TaskReader, "list_query", AsyncMock(return_value=select(Task)))


async def test_no_projects_is_refused_before_any_read() -> None:
    session = _session()
    with pytest.raises(ValidationError):
        await ProjectExportOperations(session).prepare(USER, ExportRequest(ORG, ()))
    session.connection.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_too_many_projects_is_refused_before_any_read() -> None:
    session = _session()
    ids = tuple(generate_id() for _ in range(MAX_EXPORT_PROJECTS + 1))
    with pytest.raises(ValidationError):
        await ProjectExportOperations(session).prepare(USER, ExportRequest(ORG, ids))
    session.execute.assert_not_awaited()


@pytest.mark.parametrize(
    "narrowing",
    [
        {"task_filter": _a_filter()},
        {
            "sort": (
                TaskSort(
                    field=TaskFieldRef(ref=Oneof(field="field_id", value="field_due_date")),
                    direction=SortDirection.ASC,
                ),
            )
        },
        {"view_id": "view_all"},
    ],
)
async def test_a_view_narrowing_several_projects_is_refused(narrowing: dict) -> None:
    session = _session()
    request = ExportRequest(ORG, (generate_id(), generate_id()), **narrowing)
    with pytest.raises(ValidationError, match="single project"):
        await ProjectExportOperations(session).prepare(USER, request)
    session.execute.assert_not_awaited()


async def test_one_hidden_project_denies_the_whole_export_without_naming_it(
    open_access: None,
) -> None:
    visible, hidden = _project("Visible"), _project("Hidden")
    session = _session()
    session.execute.side_effect = [_projects_result([visible])]

    with pytest.raises(PermissionDeniedError) as denied:
        await ProjectExportOperations(session).prepare(
            USER, ExportRequest(ORG, (visible.id, hidden.id))
        )

    message = str(denied.value)
    assert str(hidden.id) not in message and "Hidden" not in message
    assert session.execute.await_count == 1


async def test_the_snapshot_is_pinned_before_the_first_read(open_access: None) -> None:
    project = _project("Alpha")
    session = _session()
    session.execute.side_effect = [_projects_result([project]), _count_result(3)]

    plan = await ProjectExportOperations(session).prepare(USER, ExportRequest(ORG, (project.id,)))

    options = session.connection.await_args.kwargs["execution_options"]
    assert options == {"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}
    assert plan.row_count == 3
    assert plan.request.scope is ExportScope.PROJECT


async def test_an_export_over_the_cap_is_refused_with_a_readable_message(
    open_access: None,
) -> None:
    first, second = _project("Alpha"), _project("Beta")
    session = _session()
    session.execute.side_effect = [
        _projects_result([first, second]),
        _count_result(MAX_EXPORT_ROWS),
        _count_result(1),
    ]

    with pytest.raises(ValidationError) as refused:
        await ProjectExportOperations(session).prepare(
            USER, ExportRequest(ORG, (first.id, second.id))
        )

    assert refused.value.message == (
        "This export would include 200,001 tasks, over the 200,000 limit. "
        "Narrow the filter or export fewer projects."
    )


async def test_projects_export_in_name_order(open_access: None) -> None:
    beta, alpha = _project("beta"), _project("Alpha")
    session = _session()
    session.execute.side_effect = [_projects_result([beta, alpha]), _count_result(0), _count_result(0)]

    plan = await ProjectExportOperations(session).prepare(USER, ExportRequest(ORG, (beta.id, alpha.id)))

    assert [project.name for project in plan.projects] == ["Alpha", "beta"]


def test_an_outline_export_counts_as_a_view() -> None:
    request = ExportRequest(ORG, (generate_id(),), layout=ExportLayout.OUTLINE)
    assert request.scope is ExportScope.VIEW


def test_the_zip_sink_streams_a_valid_archive() -> None:
    sink = _ZipSink()
    chunks: list[bytes] = []
    with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ("tasks.csv", "fields.csv"):
            with archive.open(name, "w", force_zip64=True) as entry:
                for _ in range(200):
                    entry.write(b"a,b,c\r\n" * 50)
                    chunks.append(sink.drain())
    chunks.append(sink.drain())

    archive = zipfile.ZipFile(io.BytesIO(b"".join(chunks)))
    assert archive.testzip() is None
    assert archive.namelist() == ["tasks.csv", "fields.csv"]
    assert archive.read("tasks.csv") == b"a,b,c\r\n" * 50 * 200


def test_activity_values_read_as_labels() -> None:
    project_id = generate_id()
    labels = ExportLabels(MagicMock(), organization_id=ORG, user_id=USER)
    labels._options = {
        (project_id, "field_status"): {"status_done": "Done"},
        (project_id, "field_priority"): {"priority_high": "High"},
    }
    person, group = generate_id(), generate_id()
    labels._emails = {person: "ann@example.com"}
    labels._names = {group: "Platform team"}
    sprint = Sprint(id=generate_id(), project_id=project_id, organization_id=ORG, name="Sprint 4")
    labels._sprints = {sprint.id: sprint}

    def value(field_id: str | None, raw: str | None) -> str:
        return _activity_value(labels, project_id, field_id, raw)

    assert value("field_status", "status_done") == "Done"
    assert value("field_priority", "priority_high") == "High"
    assert value("field_type", "bug") == "Bug"
    assert value("field_assignee", f"{person},{group}") == "ann@example.com;Platform team"
    assert value(None, str(sprint.id)) == "Sprint 4"
    assert value("custom_text", "anything") == "anything"
    assert value("field_status", None) == ""
