from datetime import date, datetime, UTC
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import generate_id
from uniffy.domains.agents.tools.builtin.registration import register_all
from uniffy.domains.agents.tools.builtin.time import _execute_time_summary, time_summary
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import ToolRegistry
from uniffy.domains.projects.time.worklogs import AggregateGroupBy, AggregateRow

WORKLOGS = "uniffy.domains.projects.time.worklogs.WorklogOperations"
CLOCK = "uniffy.domains.agents.tools.builtin.time.datetime"
TASKS_GROUP = "Tasks"


def _ctx() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        buffer=UpdateBuffer(),
        user_timezone="Europe/Sofia",
    )


class _FrozenDatetime:
    instant = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz or UTC)


def _ops(rows: list[AggregateRow]) -> MagicMock:
    ops = MagicMock()
    ops.aggregate = AsyncMock(return_value=rows)
    return ops


async def test_me_sums_the_acting_users_last_week_by_task() -> None:
    ctx = _ctx()
    task_id = generate_id()
    ops = _ops([AggregateRow(key=str(task_id), label="Write the spec", minutes=90, entries=2)])

    with patch(CLOCK, _FrozenDatetime), patch(WORKLOGS, return_value=ops):
        result = await _execute_time_summary(ctx, {})

    assert result.success
    args, kwargs = ops.aggregate.await_args
    assert args == (ctx.user_id, ctx.organization_id)
    assert kwargs == {
        "from_date": date(2026, 10, 16),
        "to_date": date(2026, 10, 22),
        "group_by": AggregateGroupBy.TASK,
        "project_id": None,
        "user_id": ctx.user_id,
    }
    assert "You logged 1h 30m from 2026-10-16 to 2026-10-22, by task." in result.data
    assert (
        f"[[[Write the spec|urn:uniffy:content:TASK:{task_id}]]]: 1h 30m (2 entries)" in result.data
    )


async def test_a_project_scope_groups_by_person_over_the_given_range() -> None:
    ctx = _ctx()
    project_id, user_id = generate_id(), generate_id()
    ops = _ops([AggregateRow(key=str(user_id), label="Bob Smith", minutes=60, entries=1)])

    with patch(WORKLOGS, return_value=ops):
        result = await _execute_time_summary(
            ctx, {"scope": str(project_id), "from": "2026-10-01", "to": "2026-10-07"}
        )

    assert result.success
    kwargs = ops.aggregate.await_args.kwargs
    assert kwargs["project_id"] == project_id
    assert kwargs["user_id"] is None
    assert kwargs["group_by"] is AggregateGroupBy.USER
    assert (kwargs["from_date"], kwargs["to_date"]) == (date(2026, 10, 1), date(2026, 10, 7))
    assert "The project logged 1h from 2026-10-01 to 2026-10-07, by user." in result.data
    assert f"[[[Bob Smith|urn:uniffy:content:USER:{user_id}]]]: 1h (1 entry)" in result.data


async def test_days_render_as_plain_dates() -> None:
    ops = _ops([AggregateRow(key="2026-10-20", label="2026-10-20", minutes=30, entries=1)])
    with patch(CLOCK, _FrozenDatetime), patch(WORKLOGS, return_value=ops):
        result = await _execute_time_summary(_ctx(), {"group_by": "Day"})
    assert result.success
    assert ops.aggregate.await_args.kwargs["group_by"] is AggregateGroupBy.DAY
    assert "- 2026-10-20: 30m (1 entry)" in result.data


@pytest.mark.parametrize(
    ("args", "fragment"),
    [
        ({"scope": "everyone"}, "scope must be"),
        ({"group_by": "sprint"}, "group_by must be"),
        ({"from": "2026-10-08", "to": "2026-10-01"}, "from must not be after to"),
        ({"to": "next week"}, "Invalid date"),
        ({"from": "soon", "to": "2026-10-01"}, "Invalid date"),
    ],
)
async def test_bad_arguments_never_reach_the_domain(args: dict, fragment: str) -> None:
    ops = _ops([])
    with patch(WORKLOGS, return_value=ops):
        result = await _execute_time_summary(_ctx(), args)
    assert not result.success
    assert fragment in (result.error or "")
    ops.aggregate.assert_not_awaited()


def test_time_summary_is_a_registered_read_only_task_tool() -> None:
    registry = ToolRegistry()
    register_all(registry)
    assert registry.get("tasks.time_summary") is time_summary
    assert time_summary.group == TASKS_GROUP
    assert time_summary.read_only
    assert not time_summary.destructive
