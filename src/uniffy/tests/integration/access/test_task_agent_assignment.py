"""Agents assigned to tasks on live PostgreSQL: admission, the run, access rechecks and hand-back.

The model is the one boundary double: a scripted streaming client sits in the provider client
cache, where a decrypted credential would put the real one.
"""

import asyncio
import contextlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from uniffy.core.auth.acting_agent import acting_agent
from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunLog
from uniffy.core.models.agents.session import AgentSession, AgentSessionKind
from uniffy.core.models.agents.task_assignment import (
    AgentTaskAssignment,
    TaskAssignmentReason,
    TaskAssignmentStatus,
)
from uniffy.core.models.projects.activity import TaskActivity, TaskActivityAction
from uniffy.core.models.projects.field_definition import TaskStatusSemantic
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.agents.providers.base import (
    CompletionResult,
)
from uniffy.domains.agents.tasks.jobs import jobs as task_jobs
from uniffy.domains.agents.tasks.jobs.jobs import (
    deliver_task_assignment,
    recover_task_assignments,
)
from uniffy.domains.comments.converters import comment_to_proto
from uniffy.domains.comments.operations import CommentOperations
from uniffy.domains.projects.agents.operations import (
    ProjectAgentOperations,
    update_agent_policy,
)
from uniffy.domains.projects.operations import TaskOperations
from uniffy.domains.projects.statuses import load_task_status_semantics
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.task_agents import (  # noqa: F401 - fixture
    DRAFT,
    MODEL,
    ScriptedStream,
    assign,
    comments,
    rows,
    scene,
    working_turns,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_assigned_agent_works_the_task_as_the_assigner_and_hands_it_back(scene) -> None:
    scene.model.turns = working_turns(scene.task_id)
    await assign(scene, scene.access.member_id, scene.agent_id)

    [queued] = await rows(scene.task_id)
    assert queued.status == TaskAssignmentStatus.PENDING
    assert queued.is_current and queued.assigned_by == scene.access.member_id
    assert scene.woken == [queued.id]

    result = await deliver_task_assignment(scene.ctx, str(queued.id))
    assert result["status"] == "success"

    [done] = await rows(scene.task_id)
    assert done.status == TaskAssignmentStatus.COMPLETED
    async with open_session() as db:
        agent_session = await db.get(AgentSession, done.session_id)
        task = await db.get(Task, scene.task_id)
        review_id = (await load_task_status_semantics(db, task.project_id)).ids[
            TaskStatusSemantic.REVIEW
        ]
        stored = list(
            (
                await db.scalars(
                    select(AgentMessage)
                    .where(AgentMessage.session_id == done.session_id)
                    .order_by(AgentMessage.created_at)
                )
            ).all()
        )
        activity = list(
            (
                await db.scalars(
                    select(TaskActivity).where(
                        TaskActivity.task_id == scene.task_id,
                        TaskActivity.agent_id == scene.agent_id,
                    )
                )
            ).all()
        )
        kinds = set(
            (
                await db.scalars(
                    select(AgentRunLog.kind).where(AgentRunLog.session_id == done.session_id)
                )
            ).all()
        )
    assert agent_session.kind == AgentSessionKind.TASK
    assert agent_session.user_id == scene.access.member_id
    assert task.description == DRAFT
    assert task.status == review_id
    assert not task.is_deleted
    assert kinds == {AgentRunKind.TASK}

    user_rows = [row for row in stored if row.role == AgentMessageRole.USER]
    assert len(user_rows) == 1
    # Task text is workspace input: it rides the delimited brief, never the stored user turn.
    assert user_rows[0].content.startswith("Work on task ")
    assert "Write release notes" not in user_rows[0].content
    assert any("Write release notes" in str(m.get("content")) for m in scene.model.requests[0])
    assert "task-brief" not in (user_rows[0].content or "")
    first_request = scene.model.requests[0]
    assert any("task-brief-" in str(message.get("content")) for message in first_request)
    refused = [row for row in stored if row.tool_name == "tasks-delete_task" and row.tool_result]
    assert refused and "confirmation" in refused[0].tool_result

    assert {(row.action, row.actor_id) for row in activity} >= {
        (TaskActivityAction.DESCRIPTION_EDITED, scene.access.member_id),
        (TaskActivityAction.STATUS_CHANGED, scene.access.member_id),
    }
    posted = await comments(scene.task_id)
    assert [comment.body for comment in posted] == [
        "Started working on this.",
        "Drafted the release notes.",
    ]
    assert {comment.agent_id for comment in posted} == {scene.agent_id}
    assert {comment.agent_session_id for comment in posted} == {done.session_id}
    assert {comment.author_id for comment in posted} == {scene.access.member_id}


async def test_unassign_stops_the_run_and_assigning_again_starts_fresh(scene) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    await assign(scene, scene.access.member_id, None)
    [stopped] = await rows(scene.task_id)
    assert stopped.status == TaskAssignmentStatus.STOPPED and not stopped.is_current
    assert (await deliver_task_assignment(scene.ctx, str(stopped.id)))["status"] == "skipped"

    scene.model.turns = [CompletionResult(content="First pass.", model=MODEL)]
    await assign(scene, scene.access.member_id, scene.agent_id)
    first = (await rows(scene.task_id))[-1]
    await deliver_task_assignment(scene.ctx, str(first.id))

    scene.model.turns = [CompletionResult(content="Second pass.", model=MODEL)]
    await assign(scene, scene.access.member_id, scene.agent_id)
    second = (await rows(scene.task_id))[-1]
    assert second.id != first.id
    await deliver_task_assignment(scene.ctx, str(second.id))

    second = (await rows(scene.task_id))[-1]
    first = next(row for row in await rows(scene.task_id) if row.id == first.id)
    assert second.session_id != first.session_id
    second_request = scene.model.requests[-1]
    assert "First pass." not in str(second_request)


async def test_assigning_requires_task_edit_and_use_of_the_agent(scene) -> None:
    async with open_session() as db:
        await db.execute(
            update(Task).where(Task.id == scene.task_id).values(owner_id=scene.access.member_id)
        )
        await db.commit()
    with pytest.raises(NotFoundError):
        await assign(scene, scene.access.member_id, scene.private_id)
    assert await rows(scene.task_id) == []

    with pytest.raises((NotFoundError, PermissionDeniedError)):
        await assign(scene, scene.access.outsider_id, scene.agent_id)

    with acting_agent(scene.agent_id), pytest.raises(ValidationError):
        await assign(scene, scene.access.member_id, scene.agent_id)


async def test_turning_assignment_off_rejects_it_now_and_skips_queued_runs(scene) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    [queued] = await rows(scene.task_id)
    async with open_session() as db:
        await update_agent_policy(db, scene.access.admin_id, scene.access.org_id, enabled=False)
    with pytest.raises(ValidationError):
        await assign(scene, scene.access.peer_id, scene.agent_id)

    result = await deliver_task_assignment(scene.ctx, str(queued.id))
    assert result["status"] == "skipped"
    [skipped] = await rows(scene.task_id)
    assert skipped.status == TaskAssignmentStatus.SKIPPED and skipped.session_id is None
    assert scene.model.requests == []


async def test_project_agent_picks_up_new_tasks_as_their_creator(scene) -> None:
    async with open_session() as db:
        with pytest.raises(PermissionDeniedError):
            await ProjectAgentOperations(db).set_agent_assignee(
                scene.access.peer_id, scene.access.org_id, scene.project_id, scene.agent_id
            )
    async with open_session() as db:
        await ProjectAgentOperations(db).set_agent_assignee(
            scene.access.member_id, scene.access.org_id, scene.project_id, scene.agent_id
        )
    assert await rows(scene.task_id) == []

    async with open_session() as db:
        created = await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).create(
            scene.access.peer_id, scene.access.org_id, scene.project_id, title="Triage bugs"
        )
    [picked] = await rows(created.id)
    assert picked.reason == TaskAssignmentReason.PROJECT
    assert picked.assigned_by == scene.access.peer_id

    async with open_session() as db:
        with acting_agent(scene.agent_id):
            spawned = await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).create(
                scene.access.peer_id, scene.access.org_id, scene.project_id, title="Agent subtask"
            )
    assert await rows(spawned.id) == []


async def test_concurrent_assignments_leave_one_current_agent(scene) -> None:
    async def attempt() -> None:
        with contextlib.suppress(Exception):
            await assign(scene, scene.access.member_id, scene.agent_id)

    async with open_session() as db:
        await db.execute(
            update(Agent)
            .where(Agent.id == scene.private_id)
            .values(access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER)
        )
        await db.commit()

    async def other() -> None:
        with contextlib.suppress(Exception):
            await assign(scene, scene.access.peer_id, scene.private_id)

    await asyncio.gather(attempt(), other(), attempt())
    current = [row for row in await rows(scene.task_id) if row.is_current]
    assert len(current) == 1


async def test_recovery_redelivers_pending_runs_and_never_reruns_interrupted_ones(
    scene, monkeypatch
) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    [queued] = await rows(scene.task_id)
    async with open_session() as db:
        await db.execute(
            update(AgentTaskAssignment)
            .where(AgentTaskAssignment.id == queued.id)
            .values(available_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        other = await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).create(
            scene.access.member_id, scene.access.org_id, scene.project_id, title="Second"
        )
        db.add(
            AgentTaskAssignment(
                organization_id=scene.access.org_id,
                task_id=other.id,
                agent_id=scene.agent_id,
                assigned_by=scene.access.member_id,
                reason=TaskAssignmentReason.TASK,
                status=TaskAssignmentStatus.RUNNING,
                available_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        await db.commit()
    enqueued: list[tuple] = []

    async def record(ref, *args, **kwargs) -> None:
        enqueued.append(args)

    monkeypatch.setattr(task_jobs, "enqueue_job_reconnecting", record)
    await recover_task_assignments(scene.ctx)

    assert (str(queued.id),) in enqueued
    [interrupted] = await rows(other.id)
    assert interrupted.status == TaskAssignmentStatus.UNCERTAIN
    assert interrupted.ended_at is not None
    assert all(args != (str(interrupted.id),) for args in enqueued)

    # A queue backlog delays a run but never fails it, however many sweeps pass.
    for _ in range(8):
        async with open_session() as db:
            await db.execute(
                update(AgentTaskAssignment)
                .where(AgentTaskAssignment.id == queued.id)
                .values(available_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await db.commit()
        await recover_task_assignments(scene.ctx)
    [still] = [row for row in await rows(scene.task_id) if row.id == queued.id]
    assert still.status == TaskAssignmentStatus.PENDING


async def test_tasks_refuse_a_status_their_project_does_not_define(scene) -> None:
    async with open_session() as db:
        ops = TaskOperations(db, scene.storage, scene.indexer, scene.buffer)
        with pytest.raises(ValidationError, match="Unknown status"):
            await ops.update(
                scene.access.member_id, scene.access.org_id, scene.task_id, status="status_in_review"
            )
    async with open_session() as db:
        ops = TaskOperations(db, scene.storage, scene.indexer, scene.buffer)
        with pytest.raises(ValidationError, match="Unknown status"):
            await ops.create(
                scene.access.member_id,
                scene.access.org_id,
                scene.project_id,
                title="Nowhere",
                status="status_in_review",
            )
        task = await db.get(Task, scene.task_id)
        assert task.status == "status_todo"


async def test_runs_pass_the_same_spend_and_rate_gates_as_chat(scene, monkeypatch) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    [queued] = await rows(scene.task_id)

    async def over_budget(*_args, **_kwargs):
        raise BudgetExceededError("organization", "month", "10.00", "10.00")

    monkeypatch.setattr(task_jobs.BudgetsOperations, "check_preflight", over_budget)
    result = await deliver_task_assignment(scene.ctx, str(queued.id))
    assert result["status"] == "skipped"
    [skipped] = await rows(scene.task_id)
    assert skipped.status == TaskAssignmentStatus.SKIPPED and "spending" in skipped.last_error
    assert scene.model.requests == []


async def test_a_new_task_can_pick_its_agent_or_decline_the_projects(scene) -> None:
    async with open_session() as db:
        await ProjectAgentOperations(db).set_agent_assignee(
            scene.access.member_id, scene.access.org_id, scene.project_id, scene.agent_id
        )
    async with open_session() as db:
        ops = TaskOperations(db, scene.storage, scene.indexer, scene.buffer)
        declined = await ops.create(
            scene.access.peer_id,
            scene.access.org_id,
            scene.project_id,
            title="Mine alone",
            skip_project_agent=True,
        )
    assert await rows(declined.id) == []

    async with open_session() as db:
        with pytest.raises(NotFoundError):
            await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).create(
                scene.access.peer_id,
                scene.access.org_id,
                scene.project_id,
                title="Private agent",
                agent_id=scene.private_id,
            )

    async with open_session() as db:
        chosen = await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).create(
            scene.access.peer_id,
            scene.access.org_id,
            scene.project_id,
            title="Picked",
            agent_id=scene.agent_id,
        )
    [only] = await rows(chosen.id)
    assert only.reason == TaskAssignmentReason.TASK and only.assigned_by == scene.access.peer_id


async def test_deleting_a_task_stops_its_agent(scene) -> None:
    await assign(scene, scene.access.member_id, scene.agent_id)
    async with open_session() as db:
        await TaskOperations(db, scene.storage, scene.indexer, scene.buffer).delete(
            scene.access.member_id, scene.access.org_id, scene.task_id
        )
    [stopped] = await rows(scene.task_id)
    assert stopped.status == TaskAssignmentStatus.STOPPED and not stopped.is_current


async def test_agent_comments_keep_their_session_private_and_lose_credit_when_edited(scene) -> None:
    scene.model.turns = [CompletionResult(content="Done.", model=MODEL)]
    await assign(scene, scene.access.member_id, scene.agent_id)
    [queued] = await rows(scene.task_id)
    await deliver_task_assignment(scene.ctx, str(queued.id))
    started = (await comments(scene.task_id))[0]
    assert started.agent_id == scene.agent_id

    as_author = comment_to_proto(started, "Member", None, 0, [], str(scene.access.member_id))
    as_peer = comment_to_proto(started, "Member", None, 0, [], str(scene.access.peer_id))
    assert as_author.has_field("agent_session_id")
    assert not as_peer.has_field("agent_session_id")

    async with open_session() as db:
        edited, _, _ = await CommentOperations(db).update_comment(
            scene.access.member_id, scene.access.org_id, started.id, "Approved by the agent"
        )
    assert edited.agent_id is None and edited.agent_session_id is None
