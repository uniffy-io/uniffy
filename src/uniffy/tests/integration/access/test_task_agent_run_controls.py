"""Run controls for agents on tasks on live PostgreSQL: stop, hold, schedule, start, follow up."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select, update

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.task_assignment import AgentTaskAssignment, TaskAssignmentStatus
from uniffy.core.types import ContentType
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    ToolCall,
)
from uniffy.domains.agents.tasks import admission
from uniffy.domains.agents.tasks.admission import RunStart, StartMode
from uniffy.domains.agents.tasks.jobs import jobs as task_jobs
from uniffy.domains.agents.tasks.jobs.jobs import deliver_task_assignment, recover_task_assignments
from uniffy.domains.comments.operations import CommentOperations
from uniffy.domains.projects.agents.operations import TaskAgentOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.task_agents import (  # noqa: F401 - fixture
    MODEL,
    assign,
    comments,
    rows,
    scene,
    working_turns,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

WAIT = RunStart(mode=StartMode.WAIT)


async def start(scene, user_id: UUID) -> None:
    async with open_session() as db:
        await TaskAgentOperations(db).start(user_id, scene.access.org_id, scene.task_id)


async def stop(scene, user_id: UUID) -> None:
    async with open_session() as db:
        await TaskAgentOperations(db).stop(user_id, scene.access.org_id, scene.task_id)


async def request_changes(scene, user_id: UUID, changes: str) -> None:
    async with open_session() as db:
        await TaskAgentOperations(db).request_changes(
            user_id, scene.access.org_id, scene.task_id, changes
        )


@pytest.fixture
def cancelled(monkeypatch) -> list[UUID]:
    seen: list[UUID] = []

    async def record(run_id: UUID) -> bool:
        seen.append(run_id)
        return True

    monkeypatch.setattr(admission, "request_run_cancel", record)
    return seen


@pytest.fixture
def swept(monkeypatch) -> list[str]:
    seen: list[str] = []

    async def record(ref, assignment_id: str, **_: object) -> None:
        seen.append(assignment_id)

    monkeypatch.setattr(task_jobs, "enqueue_job_reconnecting", record)
    return seen


async def make_due(assignment_id: UUID) -> None:
    past = datetime.now(UTC) - timedelta(seconds=1)
    async with open_session() as db:
        await db.execute(
            update(AgentTaskAssignment)
            .where(AgentTaskAssignment.id == assignment_id)
            .values(start_at=past, available_at=past)
        )
        await db.commit()


async def test_stop_keeps_the_agent_and_running_again_starts_a_fresh_run(scene, cancelled) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    [queued] = await rows(scene.task_id)
    async with open_session() as db:
        await db.execute(
            update(AgentTaskAssignment)
            .where(AgentTaskAssignment.id == queued.id)
            .values(status=TaskAssignmentStatus.RUNNING)
        )
        await db.commit()

    # Anyone who can edit the task can stop the run, not only the person it works for.
    await stop(scene, scene.access.peer_id)

    [stopped] = await rows(scene.task_id)
    assert stopped.status == TaskAssignmentStatus.STOPPED
    assert stopped.is_current and stopped.ended_at is not None
    assert cancelled == [queued.run_id]
    assert (await deliver_task_assignment(scene.ctx, str(queued.id)))["reason"] == "not_pending"
    with pytest.raises(ValidationError):
        await stop(scene, scene.access.member_id)

    await assign(scene, scene.access.member_id, scene.agent_id)
    earlier, again = await rows(scene.task_id)
    assert (earlier.id, earlier.is_current) == (queued.id, False)
    assert again.status == TaskAssignmentStatus.PENDING and again.is_current
    assert again.run_id != queued.run_id
    assert scene.woken == [queued.id, again.id]


async def test_a_held_run_waits_for_start_and_runs_as_the_person_who_started_it(
    scene, swept
) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id, start=WAIT)
    [held] = await rows(scene.task_id)
    assert held.status == TaskAssignmentStatus.WAITING
    assert scene.woken == []
    await recover_task_assignments(scene.ctx)
    assert swept == []
    assert (await deliver_task_assignment(scene.ctx, str(held.id)))["reason"] == "not_pending"

    # Starting someone else's held run is a new run under the starter's own identity.
    await start(scene, scene.access.peer_id)
    earlier, started = await rows(scene.task_id)
    assert (earlier.status, earlier.is_current) == (TaskAssignmentStatus.STOPPED, False)
    assert started.assigned_by == scene.access.peer_id
    assert started.status == TaskAssignmentStatus.PENDING
    assert scene.woken == [started.id]
    with pytest.raises(ValidationError):
        await start(scene, scene.access.peer_id)


async def test_the_assigner_starts_their_own_held_run_in_place(scene) -> None:
    scene.model.turns = working_turns(scene.task_id)
    await assign(scene, scene.access.member_id, scene.agent_id, start=WAIT)
    await start(scene, scene.access.member_id)

    [run] = await rows(scene.task_id)
    assert run.status == TaskAssignmentStatus.PENDING and run.start_at is None
    assert scene.woken == [run.id]
    assert (await deliver_task_assignment(scene.ctx, str(run.id)))["status"] == "success"
    [done] = await rows(scene.task_id)
    assert done.status == TaskAssignmentStatus.COMPLETED


async def test_a_scheduled_run_never_starts_before_its_time(scene, swept) -> None:
    with pytest.raises(ValidationError):
        RunStart.scheduled(datetime.now(UTC) - timedelta(minutes=1))
    with pytest.raises(ValidationError):
        RunStart.scheduled(datetime.now(UTC) + timedelta(days=400))

    scene.model.turns = working_turns(scene.task_id)
    at = datetime.now(UTC) + timedelta(hours=2)
    await assign(scene, scene.access.member_id, scene.agent_id, start=RunStart.scheduled(at))
    [scheduled] = await rows(scene.task_id)
    assert scheduled.status == TaskAssignmentStatus.PENDING
    assert scheduled.start_at == at.replace(microsecond=scheduled.start_at.microsecond)
    assert scene.woken == []

    # A delivery that arrives early, however it was queued, refuses to start the run.
    assert (await deliver_task_assignment(scene.ctx, str(scheduled.id)))["reason"] == "not_pending"
    await recover_task_assignments(scene.ctx)
    assert swept == []

    await make_due(scheduled.id)
    await recover_task_assignments(scene.ctx)
    assert swept == [str(scheduled.id)]
    assert (await deliver_task_assignment(scene.ctx, str(scheduled.id)))["status"] == "success"


async def test_requested_changes_continue_the_same_session(scene) -> None:
    scene.model.turns = working_turns(scene.task_id)
    await assign(scene, scene.access.member_id, scene.agent_id)
    [first] = await rows(scene.task_id)
    await deliver_task_assignment(scene.ctx, str(first.id))

    with pytest.raises(PermissionDeniedError):
        await request_changes(scene, scene.access.peer_id, "Shorter, please.")
    with pytest.raises(ValidationError):
        await request_changes(scene, scene.access.member_id, "   ")

    scene.model.turns = [CompletionResult(content="Shortened the introduction.", model=MODEL)]
    await request_changes(scene, scene.access.member_id, "Shorten the introduction.")
    done, follow_up = await rows(scene.task_id)
    assert (done.status, done.is_current) == (TaskAssignmentStatus.COMPLETED, False)
    assert follow_up.session_id == done.session_id
    assert follow_up.change_request == "Shorten the introduction."
    assert scene.woken[-1] == follow_up.id
    with pytest.raises(ValidationError):
        await request_changes(scene, scene.access.member_id, "And the outro.")

    assert (await deliver_task_assignment(scene.ctx, str(follow_up.id)))["status"] == "success"
    async with open_session() as db:
        turns = list(
            (
                await db.scalars(
                    select(AgentMessage.content)
                    .where(
                        AgentMessage.session_id == done.session_id,
                        AgentMessage.role == AgentMessageRole.USER,
                    )
                    .order_by(AgentMessage.created_at)
                )
            ).all()
        )
    assert turns[-1] == "Shorten the introduction."
    # The follow-up sees the earlier run's work, plus a fresh brief of the task.
    request = " ".join(str(message.get("content")) for message in scene.model.requests[-1])
    assert "Drafted the release notes." in request
    assert "task-brief-" in request
    assert [c.body for c in await comments(scene.task_id)][-2:] == [
        "Working on the requested changes.",
        "Shortened the introduction.",
    ]


async def test_the_agent_reads_the_task_discussion(scene) -> None:
    async with open_session() as db:
        await CommentOperations(db).create_comment(
            user_id=scene.access.peer_id,
            organization_id=scene.access.org_id,
            content_type=ContentType.TASK,
            content_id=scene.task_id,
            body="Mention the faster search.",
        )
        await db.commit()
    read = ToolCall(id="read", name="tasks-list_comments", input={"task_id": str(scene.task_id)})
    scene.model.turns = [
        CompletionResult(
            content="", model=MODEL, stop_reason=CompletionStopReason.TOOL_USE, tool_calls=[read]
        ),
        CompletionResult(content="Read the discussion.", model=MODEL),
    ]
    await assign(scene, scene.access.member_id, scene.agent_id)
    [run] = await rows(scene.task_id)
    await deliver_task_assignment(scene.ctx, str(run.id))

    async with open_session() as db:
        result = await db.scalar(
            select(AgentMessage.tool_result).where(
                AgentMessage.session_id == (await rows(scene.task_id))[0].session_id,
                AgentMessage.tool_name == "tasks-list_comments",
                AgentMessage.role == AgentMessageRole.TOOL,
            )
        )
    assert result is not None
    assert "Peer Tester: Mention the faster search." in result
    assert "(agent, for Member Tester): Started working on this." in result
