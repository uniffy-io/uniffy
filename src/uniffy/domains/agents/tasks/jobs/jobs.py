"""Run an agent on its assigned task: claim once, recheck access, drive the session, hand back."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunLog
from uniffy.core.models.agents.session import AgentSession, AgentSessionKind
from uniffy.core.models.agents.task_assignment import (
    AgentTaskAssignment,
    TaskAssignmentReason,
    TaskAssignmentStatus,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY, UpdateBuffer
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.agents.limits.policy import check_agent_message_limits
from uniffy.domains.agents.runtime.jobs.jobs import (
    RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS,
    SessionRunLimit,
    SessionRunStatus,
    drive_session_run,
)
from uniffy.domains.agents.runtime.streams import request_run_cancel, set_run_state
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.domains.agents.tasks.admission import (
    WAKE_TIMEOUT_SECONDS,
    require_usable_agent,
    task_assignment_job_id,
)
from uniffy.domains.agents.tasks.brief import TaskBrief, render_task_brief
from uniffy.domains.agents.tasks.handback import (
    RunFacts,
    hand_back,
    notify_assigner,
    post_agent_comment,
    review_status_id,
)
from uniffy.domains.agents.tasks.jobs.contracts import DELIVER_TASK_ASSIGNMENT
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.projects.agents.policy import load_agent_policy
from uniffy.domains.projects.operations import TaskReader
from uniffy.domains.projects.tasks.notifications import TaskNotifications

logger = logger.bind(component="agents.tasks.jobs.jobs")

TASK_ASSIGNMENT_TIMEOUT_SECONDS = RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS + 60
_WATCH_INTERVAL_SECONDS = 3
_RECOVERY_BATCH = 100
_REDISPATCH_SECONDS = 30
_ERROR_LIMIT = 200


def task_key(project: Project, task: Task) -> str:
    return f"{project.slug}-{task.number}"


async def _refusal(session: AsyncSession, row: AgentTaskAssignment) -> str | None:
    """Why this run may not start now; every check repeats at run time on purpose."""
    task = await session.get(Task, row.task_id)
    if task is None or task.is_deleted or task.organization_id != row.organization_id:
        return "the task no longer exists"
    agent = await session.get(Agent, row.agent_id)
    if agent is None or agent.is_deleted or agent.organization_id != row.organization_id:
        return "the agent was deleted"
    policy = await load_agent_policy(session, row.organization_id)
    if not policy.agent_assignment_enabled:
        return "assigning tasks to agents is turned off for this organization"
    try:
        await OrganizationOperations(session).require_org_member(
            row.assigned_by, row.organization_id
        )
        await require_usable_agent(session, row.assigned_by, row.organization_id, row.agent_id)
        await TaskReader(session).get_for_edit(row.assigned_by, row.organization_id, row.task_id)
    except NotFoundError, PermissionDeniedError, ValidationError:
        return "the person it works for can no longer use this agent or edit this task"
    if row.session_id is not None and not await _session_continues(session, row):
        return "the earlier session can no longer be continued"
    # The same spend and rate gates every interactive agent send passes.
    try:
        await BudgetsOperations(session).check_preflight(
            user_id=row.assigned_by, organization_id=row.organization_id
        )
        await check_agent_message_limits(
            session,
            user_id=row.assigned_by,
            organization_id=row.organization_id,
            agent_id=row.agent_id,
        )
    except BudgetExceededError:
        return "the agent spending limit for this person or organization is reached"
    except RateLimitExceededError:
        return "too many agent messages right now; run it again in a moment"
    return None


async def _session_continues(session: AsyncSession, row: AgentTaskAssignment) -> bool:
    """A follow-up only continues the assigner's own task session with the same agent."""
    earlier = await session.get(AgentSession, row.session_id)
    return (
        earlier is not None
        and earlier.organization_id == row.organization_id
        and earlier.user_id == row.assigned_by
        and earlier.agent_id == row.agent_id
        and earlier.kind == AgentSessionKind.TASK
    )


async def _claim(session: AsyncSession, assignment_id: UUID) -> AgentTaskAssignment | None:
    return await session.scalar(
        select(AgentTaskAssignment)
        .where(
            AgentTaskAssignment.id == assignment_id,
            AgentTaskAssignment.status == TaskAssignmentStatus.PENDING,
            AgentTaskAssignment.is_current.is_(True),
            # A scheduled run never starts early, whatever queued it.
            or_(
                AgentTaskAssignment.start_at.is_(None),
                AgentTaskAssignment.start_at <= datetime.now(UTC),
            ),
        )
        .with_for_update(skip_locked=True)
    )


async def _brief(session: AsyncSession, facts: RunFacts) -> tuple[str, str]:
    task = await session.get(Task, facts.task_id)
    project = await session.get(Project, task.project_id)
    assigner = await session.get(User, facts.assigned_by)
    labels = await TaskNotifications(session).resolve_field_option_labels(
        project.id, task.status, task.priority
    )
    review_id = await review_status_id(session, project.id)
    review_label = None
    if review_id:
        review_label = (
            await TaskNotifications(session).resolve_field_option_labels(
                project.id, review_id, task.priority
            )
        ).get("status_label") or "In review"
    brief = TaskBrief(
        task_id=str(task.id),
        key=facts.task_key,
        title=task.title,
        status=labels.get("status_label") or task.status,
        priority=labels.get("priority_label") or task.priority,
        due_date=task.due_date,
        description=task.description or "",
        project_id=str(project.id),
        project_name=project.name,
        project_description=project.description or "",
        assigned_by_name=(assigner.full_name or assigner.username) if assigner else "a colleague",
        review_status=review_label,
        follow_up=facts.change_request is not None,
    )
    # The title is workspace text, so it stays inside the delimited brief, never the user turn.
    # A change request is the session owner's own message, so it is the turn.
    content = facts.change_request or f"Work on task {facts.task_key}"
    return content, render_task_brief(brief)


async def _start(session: AsyncSession, row: AgentTaskAssignment) -> RunFacts:
    """Running before the session exists, so a second delivery can never claim it."""
    started_at = datetime.now(UTC)
    row.status = TaskAssignmentStatus.RUNNING
    row.started_at = started_at
    row.available_at = started_at + timedelta(seconds=TASK_ASSIGNMENT_TIMEOUT_SECONDS)
    task = await session.get(Task, row.task_id)
    project = await session.get(Project, task.project_id)
    agent = await session.get(Agent, row.agent_id)
    key = task_key(project, task)
    assignment_id, org, task_id, agent_id, assigned_by, run_id = (
        row.id,
        row.organization_id,
        row.task_id,
        row.agent_id,
        row.assigned_by,
        row.run_id,
    )
    session_id, change_request = row.session_id, row.change_request
    agent_name = agent.name
    await session.commit()
    if session_id is None:
        agent_session = await SessionOperations(session).create_session(
            user_id=assigned_by,
            organization_id=org,
            agent_id=agent_id,
            kind=AgentSessionKind.TASK,
            display_name=f"Task {key}",
        )
        session_id = agent_session.id
        await session.execute(
            update(AgentTaskAssignment)
            .where(AgentTaskAssignment.id == assignment_id)
            .values(session_id=session_id)
        )
        await session.commit()
    return RunFacts(
        assignment_id=assignment_id,
        organization_id=org,
        task_id=task_id,
        agent_id=agent_id,
        agent_name=agent_name,
        assigned_by=assigned_by,
        session_id=session_id,
        task_key=key,
        run_id=run_id,
        started_at=started_at,
        change_request=change_request,
    )


async def _settle(
    session: AsyncSession,
    facts: RunFacts,
    status: TaskAssignmentStatus,
    error: str | None = None,
) -> bool:
    """Close the run unless an unassign already did; True when this call closed it."""
    result = await session.execute(
        update(AgentTaskAssignment)
        .where(
            AgentTaskAssignment.id == facts.assignment_id,
            AgentTaskAssignment.status == TaskAssignmentStatus.RUNNING,
            AgentTaskAssignment.is_current.is_(True),
        )
        .values(
            status=status,
            ended_at=datetime.now(UTC),
            last_error=error[:_ERROR_LIMIT] if error else None,
        )
    )
    if facts.session_id is not None and facts.started_at is not None:
        # Agent and time bound the scan to this run through ix_agents_run_logs_agent_created.
        await session.execute(
            update(AgentRunLog)
            .where(
                AgentRunLog.agent_id == facts.agent_id,
                AgentRunLog.created_at >= facts.started_at,
                AgentRunLog.session_id == facts.session_id,
            )
            .values(kind=AgentRunKind.TASK)
        )
    await session.commit()
    return bool(result.rowcount)


async def _still_running(session: AsyncSession, facts: RunFacts) -> bool:
    """The run is still wanted: current, running, on a live task, with assignment allowed."""
    row = await session.execute(
        select(AgentTaskAssignment.status, Task.is_deleted)
        .join(Task, Task.id == AgentTaskAssignment.task_id)
        .where(
            AgentTaskAssignment.id == facts.assignment_id,
            AgentTaskAssignment.is_current.is_(True),
        )
    )
    found = row.first()
    if found is None or found[0] != TaskAssignmentStatus.RUNNING or found[1]:
        return False
    return (await load_agent_policy(session, facts.organization_id)).agent_assignment_enabled


async def _watch_for_stop(factory: SessionFactory, facts: RunFacts, run_id: UUID) -> None:
    """PostgreSQL is the source of truth for a stop; the Valkey flag only reaches the run."""
    while True:
        await asyncio.sleep(_WATCH_INTERVAL_SECONDS)
        try:
            async with factory() as session:
                if await _still_running(session, facts):
                    continue
            await request_run_cancel(run_id)
            return
        except Exception:
            logger.opt(exception=True).warning("Task run watch failed for {}", facts.assignment_id)


async def deliver_task_assignment(ctx: dict[str, Any], assignment_id: str) -> dict[str, Any]:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    aid = UUID(assignment_id)
    async with factory() as session:
        row = await _claim(session, aid)
        if row is None:
            return {"status": SessionRunStatus.SKIPPED, "reason": "not_pending"}
        refusal = await _refusal(session, row)
        if refusal is not None:
            return await _skip(session, row, refusal)
        facts = await _start(session, row)
        try:
            await publish_content_changed(ContentType.TASK, facts.task_id, facts.organization_id)
            opening = (
                "Working on the requested changes."
                if facts.change_request
                else "Started working on this."
            )
            await post_agent_comment(session, facts, opening)
            content, brief = await _brief(session, facts)
        except Exception:
            logger.exception("Task run setup failed for assignment {}", aid)
            await session.rollback()
            await _settle(session, facts, TaskAssignmentStatus.FAILED, "SetupFailed")
            await publish_content_changed(ContentType.TASK, facts.task_id, facts.organization_id)
            return {"status": SessionRunStatus.ERROR, "assignment_id": assignment_id}
        run_id = cast(UUID, facts.run_id)
        session_id = cast(UUID, facts.session_id)

    await set_run_state(
        run_id=run_id,
        user_id=facts.assigned_by,
        organization_id=facts.organization_id,
        session_id=session_id,
        status="queued",
        last_seq=0,
    )
    watcher = asyncio.create_task(_watch_for_stop(factory, facts, run_id))
    try:
        outcome = await drive_session_run(
            ctx,
            run_id=run_id,
            user_id=facts.assigned_by,
            organization_id=facts.organization_id,
            session_id=session_id,
            content=content,
            trigger_brief=brief,
        )
    except Exception as exc:
        logger.exception("Task run failed for assignment {}", aid)
        outcome = {"status": SessionRunStatus.ERROR, "error": type(exc).__name__}
    finally:
        watcher.cancel()

    async with factory() as session:
        await _finish(ctx, session, facts, outcome)
    await publish_content_changed(ContentType.TASK, facts.task_id, facts.organization_id)
    return {"status": outcome.get("status"), "assignment_id": assignment_id}


async def _skip(session: AsyncSession, row: AgentTaskAssignment, refusal: str) -> dict[str, Any]:
    row.status = TaskAssignmentStatus.SKIPPED
    row.ended_at = datetime.now(UTC)
    row.last_error = refusal[:_ERROR_LIMIT]
    row_id, reason, task_id, org = row.id, row.reason, row.task_id, row.organization_id
    facts = None
    if reason == TaskAssignmentReason.PROJECT:
        agent = await session.get(Agent, row.agent_id)
        facts = RunFacts(
            assignment_id=row_id,
            organization_id=org,
            task_id=task_id,
            agent_id=row.agent_id,
            agent_name=agent.name if agent else "The agent",
            assigned_by=row.assigned_by,
            session_id=None,
            task_key="",
        )
    await session.commit()
    if facts is not None:
        await post_agent_comment(session, facts, f"Did not pick this up: {refusal}.")
    await publish_content_changed(ContentType.TASK, task_id, org)
    logger.info("Task assignment {} skipped: {}", row_id, refusal)
    return {"status": SessionRunStatus.SKIPPED, "reason": refusal}


async def _finish(
    ctx: dict[str, Any], session: AsyncSession, facts: RunFacts, outcome: dict[str, Any]
) -> None:
    status = outcome.get("status")
    if status == SessionRunStatus.CANCELLED or not await _still_running(session, facts):
        await _settle(session, facts, TaskAssignmentStatus.STOPPED)
        return
    if status == SessionRunStatus.SUCCESS and outcome.get("replied"):
        # Settled first: an unassign that lands now finds the run finished, and a run that was
        # taken back in the meantime never moves the task or announces itself.
        if not await _settle(session, facts, TaskAssignmentStatus.COMPLETED):
            return
        final = outcome.get("final_message_id")
        await hand_back(
            session,
            facts,
            final_message_id=UUID(final) if final else None,
            storage=cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY]),
            search_indexer=ctx[SEARCH_INDEXER_CTX_KEY],
            buffer=cast(UpdateBuffer, ctx[UPDATE_BUFFER_CTX_KEY]),
        )
        return
    error = str(outcome.get("error") or "the run ended without a reply")
    if await _settle(session, facts, TaskAssignmentStatus.FAILED, error):
        await post_agent_comment(session, facts, failure_comment(outcome.get("limit")))
        await notify_assigner(
            session,
            facts,
            title=f"{facts.agent_name} could not finish {facts.task_key}",
            body="The run stopped with an error.",
        )


def failure_comment(limit: SessionRunLimit | None) -> str:
    """What the assigner reads on the task; provider and stack details stay in the logs."""
    if limit == SessionRunLimit.STEP_LIMIT:
        return (
            "Stopped at the step limit before finishing. What it did so far is on the task; "
            "request changes or run it again to carry on."
        )
    if limit == SessionRunLimit.DEADLINE:
        return "Ran out of time before finishing. Request changes or run it again to carry on."
    return "Could not finish this task. The person it worked for can open the session for details."


async def recover_task_assignments(ctx: dict[str, Any]) -> None:
    factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    now = datetime.now(UTC)
    async with factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(AgentTaskAssignment)
                    .where(
                        AgentTaskAssignment.status.in_([
                            TaskAssignmentStatus.PENDING,
                            TaskAssignmentStatus.RUNNING,
                        ]),
                        AgentTaskAssignment.available_at <= now,
                    )
                    .order_by(AgentTaskAssignment.available_at, AgentTaskAssignment.id)
                    .limit(_RECOVERY_BATCH)
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        pending: list[UUID] = []
        for row in rows:
            if row.status == TaskAssignmentStatus.RUNNING:
                # A paid run that may have acted is never repeated without a person deciding to.
                row.status = TaskAssignmentStatus.UNCERTAIN
                row.last_error = "WorkerInterrupted"
                row.ended_at = now
                logger.error("Agent task run interrupted: {}", row.id)
            else:
                # Pending stays pending until a delivery claims it: a queue backlog delays a
                # run, it never fails one. The stable job id keeps each row queued once.
                row.available_at = now + timedelta(seconds=_REDISPATCH_SECONDS)
                row.dispatches += 1
                pending.append(row.id)
        await session.commit()
    for aid in pending:
        try:
            async with asyncio.timeout(WAKE_TIMEOUT_SECONDS):
                # The sweep runs on the core fleet, which opens the egress pool on demand.
                await enqueue_job_reconnecting(
                    DELIVER_TASK_ASSIGNMENT, str(aid), _job_id=task_assignment_job_id(aid)
                )
        except Exception:
            logger.warning("Agent task recovery enqueue failed: {}", aid)
