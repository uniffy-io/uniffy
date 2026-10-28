from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from uniffy.core.models.projects.worklog import WorklogSource
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import generate_id
from uniffy.domains.agents.tools.builtin.registration import register_all
from uniffy.domains.agents.tools.builtin.time import _execute_log_time, _today_for, log_time
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import ToolRegistry

READER = "uniffy.domains.projects.operations.TaskReader"
TASKS_GROUP = "Tasks"
LOGGED_PREFIX = "Logged 1h 30m on [[[Write the spec|urn:uniffy:content:TASK:"
LOGGED_SUFFIX = "for 2026-10-20. Task total: 2h 30m."
WORKLOGS = "uniffy.domains.projects.time.worklogs.WorklogOperations"


def _ctx(timezone: str | None = None) -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        buffer=UpdateBuffer(),
        user_timezone=timezone,
    )


def _task(task_id):
    return SimpleNamespace(id=task_id, title="Write the spec")


class _FrozenDatetime:
    """23:30 UTC on 2026-10-21, so the user's zone decides which calendar day it is."""

    instant = datetime(2026, 10, 21, 23, 30, tzinfo=UTC)

    @classmethod
    def now(cls, tz=None):
        return cls.instant.astimezone(tz or UTC)


async def test_logs_the_acting_users_own_time_as_an_agent_entry() -> None:
    ctx = _ctx()
    task_id = generate_id()
    reader = MagicMock()
    reader.get_by_id = AsyncMock(return_value=_task(task_id))
    ops = MagicMock()
    ops.create = AsyncMock(return_value=(MagicMock(), 150))

    with patch(READER, return_value=reader), patch(WORKLOGS, return_value=ops):
        result = await _execute_log_time(
            ctx,
            {
                "task_id": str(task_id),
                "duration": "1h 30m",
                "date": "2026-10-20",
                "description": "spec review",
            },
        )

    assert result.success
    reader.get_by_id.assert_awaited_once_with(ctx.user_id, ctx.organization_id, task_id)
    args, kwargs = ops.create.await_args
    assert args == (ctx.user_id, ctx.organization_id, task_id)
    assert kwargs == {
        "work_date": date(2026, 10, 20),
        "duration_minutes": 90,
        "description": "spec review",
        "source": WorklogSource.AGENT,
    }
    assert LOGGED_PREFIX in result.data
    assert LOGGED_SUFFIX in result.data


async def test_defaults_to_today_in_the_users_timezone() -> None:
    ctx = _ctx("Pacific/Auckland")
    task_id = generate_id()
    reader = MagicMock()
    reader.get_by_id = AsyncMock(return_value=_task(task_id))
    ops = MagicMock()
    ops.create = AsyncMock(return_value=(MagicMock(), 30))

    with (
        patch("uniffy.domains.agents.tools.builtin.time.datetime", _FrozenDatetime),
        patch(READER, return_value=reader),
        patch(WORKLOGS, return_value=ops),
    ):
        result = await _execute_log_time(ctx, {"task_id": str(task_id), "duration": "30m"})

    assert result.success
    assert ops.create.await_args.kwargs["work_date"] == date(2026, 10, 22)
    assert ops.create.await_args.kwargs["description"] == ""


def test_unknown_timezone_falls_back_to_utc() -> None:
    with patch("uniffy.domains.agents.tools.builtin.time.datetime", _FrozenDatetime):
        assert _today_for(_ctx("Mars/Olympus")) == date(2026, 10, 21)
        assert _today_for(_ctx(None)) == date(2026, 10, 21)
        assert (
            _today_for(_ctx("Pacific/Auckland"))
            == _FrozenDatetime.instant.astimezone(ZoneInfo("Pacific/Auckland")).date()
        )


@pytest.mark.parametrize(
    ("args", "fragment"),
    [
        ({"task_id": "nope", "duration": "1h"}, "Invalid task_id"),
        ({"task_id": str(generate_id()), "duration": "soon"}, "duration must be"),
        ({"task_id": str(generate_id()), "duration": "0m"}, "duration must be"),
        ({"task_id": str(generate_id()), "duration": "1h", "date": "yesterday"}, "Invalid date"),
    ],
)
async def test_bad_arguments_never_reach_the_domain(args: dict, fragment: str) -> None:
    ops = MagicMock()
    ops.create = AsyncMock()

    with patch(READER) as reader, patch(WORKLOGS, return_value=ops):
        result = await _execute_log_time(_ctx(), args)

    assert not result.success
    assert fragment in (result.error or "")
    reader.assert_not_called()
    ops.create.assert_not_awaited()


def test_log_time_is_a_registered_task_write_tool() -> None:
    registry = ToolRegistry()
    register_all(registry)

    registered = registry.get("tasks.log_time")
    assert registered is log_time
    assert log_time.group == TASKS_GROUP
    assert not log_time.destructive
    assert not log_time.read_only
    assert set(log_time.parameter_schema["required"]) == {"task_id", "duration"}
