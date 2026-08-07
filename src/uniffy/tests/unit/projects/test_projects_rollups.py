"""Unit tests for the project rollup query and its proto mapping.

Pins the three semantics the clients depend on: completion is measured off
``completed_at``, the task counts are top-level only while the workload sums
span the whole tree, and every read is scoped to one organization.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.projects import queries
from uniffy.domains.projects.handlers import _ProjectRollups


def _capturing_session(rows: list) -> tuple[AsyncMock, list]:
    """Session mock that records the statement it was handed and returns `rows`."""
    captured: list = []

    async def execute(stmt):  # noqa: ANN001 - SQLAlchemy statement
        captured.append(stmt)
        result = MagicMock()
        result.all.return_value = rows
        return result

    return AsyncMock(side_effect=execute), captured


def _compiled(stmt) -> str:  # noqa: ANN001 - SQLAlchemy statement
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


@pytest.mark.asyncio
async def test_rollup_query_is_scoped_to_the_organization():
    org_id = generate_id()
    project_id = generate_id()
    execute, captured = _capturing_session([])
    session = MagicMock()
    session.execute = execute

    await queries.get_task_rollups_for_projects(session, org_id, [project_id])

    # The dialect renders a UUID literal unhyphenated.
    sql = _compiled(captured[0])
    assert f"projects_tasks.organization_id = '{org_id.hex}'" in sql
    assert f"projects_tasks.project_id in ('{project_id.hex}')" in sql
    assert "projects_tasks.is_deleted = false" in sql


@pytest.mark.asyncio
async def test_completion_is_measured_off_completed_at_not_the_status_id():
    execute, captured = _capturing_session([])
    session = MagicMock()
    session.execute = execute

    await queries.get_task_rollups_for_projects(session, generate_id(), [generate_id()])

    sql = _compiled(captured[0])
    assert "completed_at is not null" in sql
    # A project may rename or replace its Done column, so the literal must not
    # be what decides whether a task counts as complete.
    assert "status_done" not in sql


@pytest.mark.asyncio
async def test_counts_are_top_level_only_while_workload_spans_the_tree():
    execute, captured = _capturing_session([])
    session = MagicMock()
    session.execute = execute

    await queries.get_task_rollups_for_projects(session, generate_id(), [generate_id()])

    sql = _compiled(captured[0])
    # The parent_id restriction belongs to the two counts, not to the WHERE
    # clause - an overdue subtask is overdue work, and its time still adds up.
    where = sql.split("group by")[0].split("where")[1]
    assert "parent_id is null" not in where
    assert sql.count("parent_id is null") == 2


@pytest.mark.asyncio
async def test_empty_project_list_short_circuits():
    session = MagicMock()
    session.execute = AsyncMock()

    assert await queries.get_task_rollups_for_projects(session, generate_id(), []) == {}
    session.execute.assert_not_awaited()


def test_rollups_default_to_zero_for_a_project_with_no_tasks():
    project_id = generate_id()
    rollups = _ProjectRollups(tasks={}, members={})

    counts = rollups.for_project(project_id)

    assert counts.task_total == 0
    assert counts.task_done == 0
    assert counts.members == 0
    assert counts.overdue == 0
    assert counts.estimated_minutes == 0
    assert counts.time_spent_minutes == 0


def test_rollups_map_each_field_onto_the_proto_counts():
    project_id: UUID = generate_id()
    rollups = _ProjectRollups(
        tasks={
            project_id: queries.ProjectTaskRollup(
                total=7,
                completed=3,
                overdue=2,
                estimated_minutes=480,
                time_spent_minutes=520,
            )
        },
        members={project_id: 4},
    )

    counts = rollups.for_project(project_id)

    assert counts.task_total == 7
    assert counts.task_done == 3
    assert counts.members == 4
    assert counts.overdue == 2
    assert counts.estimated_minutes == 480
    assert counts.time_spent_minutes == 520
