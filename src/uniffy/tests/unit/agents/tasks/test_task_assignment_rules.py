"""Project pickup early returns and who may see a task run's session."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from uniffy.core.auth.acting_agent import acting_agent
from uniffy.core.models.agents.session import AgentSessionKind
from uniffy.core.models.agents.task_assignment import TaskAssignmentReason, TaskAssignmentStatus
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.runtime.context.memory import MemoryContextBuilder
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.tasks.admission import AssignmentView
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.domains.projects.agents import pickup
from uniffy.domains.projects.agents.policy import ResolvedAgentPolicy
from uniffy.domains.projects.converters import agent_assignment_to_proto


def view(assigned_by) -> AssignmentView:
    return AssignmentView(
        id=uuid4(),
        task_id=uuid4(),
        agent_id=uuid4(),
        agent_name="Writer",
        agent_avatar_emoji=None,
        agent_is_deleted=False,
        assigned_by=assigned_by,
        status=TaskAssignmentStatus.RUNNING,
        reason=TaskAssignmentReason.TASK,
        session_id=uuid4(),
        run_id=uuid4(),
        created_at=datetime.now(UTC),
        ended_at=None,
        start_at=None,
    )


def test_only_the_assigner_receives_session_and_run_ids() -> None:
    assigner = uuid4()
    row = view(assigner)
    mine = agent_assignment_to_proto(row, assigner)
    theirs = agent_assignment_to_proto(row, uuid4())
    assert mine.session_id == str(row.session_id) and mine.run_id == str(row.run_id)
    assert not theirs.has_field("session_id") and not theirs.has_field("run_id")
    assert theirs.agent_name == "Writer"


@pytest.fixture
def staged(monkeypatch):
    calls = []

    async def fake_stage(session, **kwargs):
        calls.append(kwargs)
        return "staged"

    monkeypatch.setattr(pickup, "stage_task_assignment", fake_stage)
    return calls


def scene(agent_id=None):
    org = uuid4()
    task = SimpleNamespace(id=uuid4(), organization_id=org, owner_id=uuid4())
    return task, SimpleNamespace(agent_assignee_id=agent_id)


def policy(monkeypatch, enabled: bool) -> None:
    async def load(session, organization_id):
        return ResolvedAgentPolicy(organization_id, agent_assignment_enabled=enabled)

    monkeypatch.setattr(pickup, "load_agent_policy", load)


async def test_pickup_runs_as_the_task_creator(staged, monkeypatch) -> None:
    policy(monkeypatch, True)
    task, project = scene(uuid4())
    assert await pickup.stage_project_pickup(None, task=task, project=project) == "staged"
    assert staged[0]["assigned_by"] == task.owner_id
    assert staged[0]["reason"] == TaskAssignmentReason.PROJECT


async def test_pickup_skips_projects_without_an_agent_and_policy_off(staged, monkeypatch) -> None:
    policy(monkeypatch, False)
    task, project = scene(None)
    assert await pickup.stage_project_pickup(None, task=task, project=project) is None
    task, project = scene(uuid4())
    assert await pickup.stage_project_pickup(None, task=task, project=project) is None
    assert staged == []


async def test_tasks_an_agent_creates_never_trigger_another_agent(staged, monkeypatch) -> None:
    policy(monkeypatch, True)
    task, project = scene(uuid4())
    with acting_agent(uuid4()):
        assert await pickup.stage_project_pickup(None, task=task, project=project) is None
    assert staged == []


async def test_task_sessions_keep_memory_in_their_own_bucket() -> None:
    session_id = uuid4()
    scope = await MemoryContextBuilder(None).resolve_scope(
        destination=SessionDestination(session_id=session_id),
        user_id=uuid4(),
        organization_id=uuid4(),
        session_kind=AgentSessionKind.TASK,
    )
    assert scope == MemoryScopeRef.session(session_id)


def test_unattended_runs_leave_deletes_and_schedules_to_a_person() -> None:
    registry = get_tool_registry()
    assert registry.needs_person("cron.create") and registry.needs_person("cron-update")
    assert registry.needs_person("tasks.delete_task")
    assert not registry.needs_person("tasks.update_task")
    assert not registry.needs_person("cron.list")
