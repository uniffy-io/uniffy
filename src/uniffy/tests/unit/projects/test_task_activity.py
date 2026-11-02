from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from uniffy_proto.projects.v1.projects_pb import UpdateTaskRequest

from uniffy.core.auth.acting_agent import acting_agent
from uniffy.core.models.projects.activity import TaskActivity, TaskActivityAction
from uniffy.core.models.projects.task import Task
from uniffy.core.types import generate_id
from uniffy.domains.projects.converters import ACTIVITY_ACTION_TO_PROTO
from uniffy.domains.projects.tasks.activity import (
    FIELD_ACTIONS,
    NOT_LOGGED,
    SEPARATELY_LOGGED,
    TaskActivityRecorder,
    activity_text,
)
from uniffy.domains.projects.tasks.notifications import TaskNotifications

# Columns the system maintains; nobody edits them through an update.
_SYSTEM_COLUMNS = {
    "id",
    "project_id",
    "organization_id",
    "owner_id",
    "completed_at",
    "outgoing_references",
    "number",
    "time_spent_minutes",
    "is_deleted",
    "version",
    "created_at",
    "updated_at",
    "deleted_at",
}
# Proto request fields whose update argument carries another name.
_REQUEST_TO_ARGUMENT = {"blocked_by": "blocked_by_task_ids"}
_REQUEST_ADDRESSING = {"organization_id", "task_id"}

_COVERED = set(FIELD_ACTIONS) | SEPARATELY_LOGGED | NOT_LOGGED


def test_every_editable_task_column_has_an_activity_decision() -> None:
    editable = set(Task.model_fields) - _SYSTEM_COLUMNS
    assert editable - _COVERED == set(), (
        "A task column has no activity mapping: add it to FIELD_ACTIONS, SEPARATELY_LOGGED or "
        "NOT_LOGGED"
    )


def test_every_update_request_field_has_an_activity_decision() -> None:
    fields = {f.name for f in UpdateTaskRequest.desc().fields} - _REQUEST_ADDRESSING
    arguments = {_REQUEST_TO_ARGUMENT.get(name, name) for name in fields}
    assert arguments - _COVERED == set()


def test_every_action_reaches_clients() -> None:
    assert set(TaskActivityAction) == set(ACTIVITY_ACTION_TO_PROTO)


@pytest.mark.parametrize(
    ("value", "text"),
    [(None, None), ("", None), ([], None), (True, "true"), (["a", "b"], "a,b"), (30, "30")],
)
def test_activity_text(value: object, text: str | None) -> None:
    assert activity_text(value) == text


def _recorder() -> tuple[TaskActivityRecorder, AsyncMock]:
    recorder = TaskActivityRecorder(MagicMock())
    log = AsyncMock()
    recorder.writer = MagicMock(log_activity=log)
    return recorder, log


async def test_field_change_records_from_and_to() -> None:
    recorder, log = _recorder()
    task_id, actor = generate_id(), generate_id()
    await recorder.field_change(task_id, actor, "due_date", "2026-11-01", None)
    log.assert_awaited_once_with(
        task_id,
        actor,
        TaskActivityAction.DUE_DATE_CHANGED,
        field_id="field_due_date",
        previous_value="2026-11-01",
        new_value=None,
    )


async def test_custom_fields_record_only_changed_values() -> None:
    recorder, log = _recorder()
    task_id, actor = generate_id(), generate_id()
    await recorder.custom_fields(
        task_id, actor, {"f1": "a", "f2": ["x"]}, {"f1": "a", "f2": ["x", "y"], "f3": 5}
    )
    calls = [(c.kwargs["field_id"], c.kwargs["previous_value"], c.kwargs["new_value"]) for c in log.await_args_list]
    assert calls == [("f2", '["x"]', '["x","y"]'), ("f3", None, "5")]


async def test_blockers_are_recorded_on_both_ends() -> None:
    recorder, log = _recorder()
    task_id, actor = generate_id(), generate_id()
    kept, added, removed = str(generate_id()), str(generate_id()), str(generate_id())
    recorder._existing_tasks = AsyncMock(return_value=[added, removed])  # type: ignore[method-assign]
    await recorder.blockers(task_id, actor, [kept, removed], [kept, added])
    recorded = [(c.args[0], c.args[2]) for c in log.await_args_list]
    assert recorded == [
        (task_id, TaskActivityAction.BLOCKED_BY_ADDED),
        (UUID(added), TaskActivityAction.BLOCKING_ADDED),
        (task_id, TaskActivityAction.BLOCKED_BY_REMOVED),
        (UUID(removed), TaskActivityAction.BLOCKING_REMOVED),
    ]


async def test_blockers_skip_the_far_end_of_a_purged_task() -> None:
    recorder, log = _recorder()
    gone = str(generate_id())
    recorder._existing_tasks = AsyncMock(return_value=[])  # type: ignore[method-assign]
    await recorder.blockers(generate_id(), generate_id(), [gone], [])
    assert [c.args[2] for c in log.await_args_list] == [TaskActivityAction.BLOCKED_BY_REMOVED]


def _writer(latest: TaskActivity | None) -> tuple[TaskNotifications, MagicMock]:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: latest))
    session.flush = AsyncMock()
    return TaskNotifications(session), session


def _edit(actor, *, minutes_ago: int, agent=None, action=TaskActivityAction.DESCRIPTION_EDITED):
    return TaskActivity(
        task_id=generate_id(),
        actor_id=actor,
        agent_id=agent,
        action=action,
        timestamp=datetime.now(UTC) - timedelta(minutes=minutes_ago),
    )


async def test_description_edits_in_one_session_extend_the_entry() -> None:
    actor = generate_id()
    latest = _edit(actor, minutes_ago=3)
    before = latest.timestamp
    writer, session = _writer(latest)
    entry = await writer.log_description_edit(latest.task_id, actor)
    assert entry is latest
    assert latest.timestamp > before
    session.add.assert_not_called()


@pytest.mark.parametrize(
    "latest_kind", ["idle", "other_person", "other_action", "agent", "none"]
)
async def test_description_edit_starts_a_new_entry(latest_kind: str) -> None:
    actor = generate_id()
    latest = {
        "idle": _edit(actor, minutes_ago=6),
        "other_person": _edit(generate_id(), minutes_ago=1),
        "other_action": _edit(actor, minutes_ago=1, action=TaskActivityAction.TITLE_CHANGED),
        "agent": _edit(actor, minutes_ago=1, agent=generate_id()),
        "none": None,
    }[latest_kind]
    writer, session = _writer(latest)
    entry = await writer.log_description_edit(generate_id(), actor)
    assert entry is not latest
    assert entry.action == TaskActivityAction.DESCRIPTION_EDITED
    session.add.assert_called_once()


async def test_entries_written_during_a_tool_call_credit_the_agent() -> None:
    writer, session = _writer(None)
    agent = generate_id()
    with acting_agent(agent):
        entry = await writer.log_activity(
            generate_id(), generate_id(), TaskActivityAction.TITLE_CHANGED
        )
    outside = await writer.log_activity(generate_id(), generate_id(), TaskActivityAction.CREATED)
    assert entry.agent_id == agent
    assert outside.agent_id is None
