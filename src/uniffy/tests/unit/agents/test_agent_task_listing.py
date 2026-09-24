from unittest.mock import AsyncMock, MagicMock

import pytest
from uniffy_proto.projects.v1.projects_pb import (
    FilterLogic,
    SortDirection,
    TaskFilterOperator,
    TaskPseudoField,
)

from uniffy.core.types import generate_id
from uniffy.domains.agents.tools.builtin.projects import _execute_list_tasks
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.projects.operations import TaskReader

TOP_LEVEL = {
    "logic": "FILTER_LOGIC_AND",
    "nodes": [
        {
            "condition": {
                "field": {"pseudo": "TASK_PSEUDO_FIELD_DEPTH"},
                "operator": "TASK_FILTER_OPERATOR_IS",
                "value": {"number": 0},
            }
        }
    ],
}
BY_DUE = [{"field": {"field_id": "field_due_date"}, "direction": "SORT_DIRECTION_DESC"}]


@pytest.fixture
def reader(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    list_tasks = AsyncMock(return_value=([], 0))
    monkeypatch.setattr(TaskReader, "list_tasks", list_tasks)
    return MagicMock(list_tasks=list_tasks)


def _context() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        user_timezone="Europe/Sofia",
    )


async def test_a_filter_tree_and_sort_reach_the_reader(reader: MagicMock) -> None:
    result = await _execute_list_tasks(
        _context(), {"project_id": str(generate_id()), "filter": TOP_LEVEL, "sort": BY_DUE}
    )

    assert result.success
    call = reader.list_tasks.await_args.kwargs
    condition = call["task_filter"].nodes[0].node.value
    assert call["task_filter"].logic == FilterLogic.AND
    assert condition.field.ref.value == TaskPseudoField.DEPTH
    assert condition.operator == TaskFilterOperator.IS
    assert call["sort"][0].direction == SortDirection.DESC
    assert call["time_zone"] == "Europe/Sofia"
    assert call["view"] is None


async def test_a_view_leaves_unset_what_the_call_leaves_out(reader: MagicMock) -> None:
    await _execute_list_tasks(
        _context(), {"project_id": str(generate_id()), "view": "Board", "sort": BY_DUE}
    )

    call = reader.list_tasks.await_args.kwargs
    assert call["view"] == "Board"
    assert call["task_filter"] is None
    assert call["sort"][0].direction == SortDirection.DESC


async def test_a_full_page_says_how_many_more_there_are(reader: MagicMock) -> None:
    task = MagicMock(title="T", assignee_ids=[], blocked_by_task_ids=[], is_milestone=False)
    task.configure_mock(due_date=None, start_date=None, parent_id=None, sprint_id=None)
    reader.list_tasks.return_value = ([task, task], 5)

    result = await _execute_list_tasks(
        _context(), {"project_id": str(generate_id()), "limit": 2, "page": 2}
    )

    assert result.data.splitlines()[0] == "Found 5 tasks (showing 3-4):"
    assert result.data.splitlines()[-1].startswith("1 more not shown. Ask for page 3")
    assert reader.list_tasks.await_args.kwargs["page_size"] == 2


async def test_a_malformed_filter_is_reported_to_the_model(reader: MagicMock) -> None:
    result = await _execute_list_tasks(
        _context(),
        {"project_id": str(generate_id()), "filter": {"logic": "SOMETIMES", "nodes": []}},
    )

    assert not result.success
    assert "Invalid filter or sort" in (result.error or "")
    reader.list_tasks.assert_not_awaited()
