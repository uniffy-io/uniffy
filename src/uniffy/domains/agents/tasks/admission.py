"""Durable admission for agents assigned to tasks; the capability the projects domain calls."""

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.roles import role_can_view
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.task_assignment import (
    ACTIVE_ASSIGNMENT_STATUSES,
    ENDED_ASSIGNMENT_STATUSES,
    OPEN_ASSIGNMENT_STATUSES,
    AgentTaskAssignment,
    TaskAssignmentReason,
    TaskAssignmentStatus,
)
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.agents.cache import fetch_agent_row
from uniffy.domains.agents.runtime.streams import request_run_cancel
from uniffy.domains.agents.tasks.jobs.contracts import DELIVER_TASK_ASSIGNMENT

logger = logger.bind(component="agents.tasks.admission")

WAKE_TIMEOUT_SECONDS = 0.15
_RECOVERY_GRACE_SECONDS = 30
MAX_START_AHEAD = timedelta(days=366)
MAX_CHANGE_REQUEST_CHARS = 4000


class StartMode(StrEnum):
    NOW = "now"
    WAIT = "wait"
    AT = "at"


@dataclass(frozen=True)
class RunStart:
    """When a newly staged run may start."""

    mode: StartMode = StartMode.NOW
    at: datetime | None = None

    @classmethod
    def scheduled(cls, at: datetime) -> RunStart:
        now = datetime.now(UTC)
        if at <= now:
            raise ValidationError("start_at", "Pick a start time in the future")
        if at > now + MAX_START_AHEAD:
            raise ValidationError("start_at", "Pick a start time within a year")
        return cls(mode=StartMode.AT, at=at)


START_NOW = RunStart()


def task_assignment_job_id(assignment_id: UUID) -> str:
    """One queue entry per assignment, so the wake and every recovery pass deduplicate."""
    return f"task-assignment:{assignment_id}"


async def require_usable_agent(
    session: AsyncSession, user_id: UUID, organization_id: UUID, agent_id: UUID
) -> None:
    """NotFound for an agent the person cannot use, so its existence does not leak."""
    agent = await fetch_agent_row(session, agent_id, organization_id)
    if agent is None or agent.is_deleted:
        raise NotFoundError(ContentType.AGENT.value, agent_id)
    role = await PermissionChecker(session).effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.AGENT,
        content_id=agent.id,
        owner_id=agent.owner_id,
        access_mode=agent.access_mode,
        baseline_role=agent.baseline_role,
    )
    if not role_can_view(role):
        raise NotFoundError(ContentType.AGENT.value, agent_id)


async def require_budget_headroom(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> None:
    """Refuse an assignment up front rather than queue a run the spend cap would stop."""
    await BudgetsOperations(session).check_preflight(
        user_id=user_id, organization_id=organization_id
    )


async def lock_task_assignments(session: AsyncSession, organization_id: UUID, task_id: UUID) -> None:
    """Serialize every change to one task's agent assignee behind the task row lock."""
    await session.execute(
        select(Task.id)
        .where(Task.id == task_id, Task.organization_id == organization_id)
        .with_for_update()
    )


@dataclass(frozen=True)
class StagedAssignment:
    """What the caller's commit made true: a run to wake and runs to stop."""

    assignment_id: UUID | None = None
    stopped_run_ids: tuple[UUID, ...] = ()
    previous_agent_id: UUID | None = None
    # False for a run that waits for Start or for its scheduled time.
    wake: bool = True


@dataclass(frozen=True)
class AssignmentView:
    id: UUID
    task_id: UUID
    agent_id: UUID
    agent_name: str
    agent_avatar_emoji: str | None
    agent_is_deleted: bool
    assigned_by: UUID
    status: TaskAssignmentStatus
    reason: TaskAssignmentReason
    session_id: UUID | None
    run_id: UUID
    created_at: datetime
    ended_at: datetime | None
    start_at: datetime | None


async def read_current_assignment(
    session: AsyncSession, organization_id: UUID, task_id: UUID
) -> AgentTaskAssignment | None:
    """The row as committed now; a run may have moved it since this session last read it."""
    return await session.scalar(
        select(AgentTaskAssignment)
        .where(
            AgentTaskAssignment.organization_id == organization_id,
            AgentTaskAssignment.task_id == task_id,
            AgentTaskAssignment.is_current.is_(True),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def read_current_assignments(
    session: AsyncSession, organization_id: UUID, task_ids: Iterable[UUID]
) -> dict[UUID, AssignmentView]:
    ids = list(dict.fromkeys(task_ids))
    if not ids:
        return {}
    rows = await session.execute(
        select(AgentTaskAssignment, Agent.name, Agent.avatar_emoji, Agent.is_deleted)
        .join(Agent, Agent.id == AgentTaskAssignment.agent_id)
        .where(
            AgentTaskAssignment.organization_id == organization_id,
            AgentTaskAssignment.task_id.in_(ids),
            AgentTaskAssignment.is_current.is_(True),
        )
    )
    return {
        row.task_id: AssignmentView(
            id=row.id,
            task_id=row.task_id,
            agent_id=row.agent_id,
            agent_name=name,
            agent_avatar_emoji=emoji or None,
            agent_is_deleted=bool(is_deleted),
            assigned_by=row.assigned_by,
            status=TaskAssignmentStatus(row.status),
            reason=TaskAssignmentReason(row.reason),
            session_id=row.session_id,
            run_id=row.run_id,
            created_at=row.created_at,
            ended_at=row.ended_at,
            start_at=row.start_at,
        )
        for row, name, emoji, is_deleted in rows.all()
    }


async def _retire_current(
    session: AsyncSession, organization_id: UUID, task_id: UUID
) -> tuple[tuple[UUID, ...], UUID | None]:
    """Clear the task's current row; a run still waiting or working becomes stopped."""
    await lock_task_assignments(session, organization_id, task_id)
    current = await read_current_assignment(session, organization_id, task_id)
    if current is None:
        return (), None
    stopped = _stop(current)
    current.is_current = False
    await session.flush()
    return stopped, current.agent_id


def _stop(row: AgentTaskAssignment) -> tuple[UUID, ...]:
    """Mark an unfinished run stopped; returns the run to cancel when one may be live."""
    if row.status not in OPEN_ASSIGNMENT_STATUSES:
        return ()
    live = row.status in ACTIVE_ASSIGNMENT_STATUSES
    row.status = TaskAssignmentStatus.STOPPED
    row.ended_at = datetime.now(UTC)
    return (row.run_id,) if live else ()


async def stage_task_assignment(
    session: AsyncSession,
    *,
    organization_id: UUID,
    task_id: UUID,
    agent_id: UUID,
    assigned_by: UUID,
    reason: TaskAssignmentReason,
    start: RunStart = START_NOW,
    session_id: UUID | None = None,
    change_request: str | None = None,
) -> StagedAssignment:
    """Make the agent the task's agent assignee with a fresh run; never commits."""
    stopped, previous_agent_id = await _retire_current(session, organization_id, task_id)
    row = AgentTaskAssignment(
        organization_id=organization_id,
        task_id=task_id,
        agent_id=agent_id,
        assigned_by=assigned_by,
        reason=reason,
        session_id=session_id,
        change_request=change_request,
    )
    _schedule(row, start)
    session.add(row)
    await session.flush()
    return StagedAssignment(
        assignment_id=row.id,
        stopped_run_ids=stopped,
        previous_agent_id=previous_agent_id,
        wake=start.mode == StartMode.NOW,
    )


def _schedule(row: AgentTaskAssignment, start: RunStart) -> None:
    now = datetime.now(UTC)
    if start.mode == StartMode.WAIT:
        row.status = TaskAssignmentStatus.WAITING
        row.start_at = None
        row.available_at = now
    elif start.mode == StartMode.AT and start.at is not None:
        row.status = TaskAssignmentStatus.PENDING
        # The sweep enqueues it once due; the delivery refuses to start it earlier.
        row.start_at = start.at
        row.available_at = start.at
    else:
        row.status = TaskAssignmentStatus.PENDING
        row.start_at = None
        # The wake after commit delivers it; recovery only steps in once this passes.
        row.available_at = now + timedelta(seconds=_RECOVERY_GRACE_SECONDS)


async def _require_current(
    session: AsyncSession, organization_id: UUID, task_id: UUID
) -> AgentTaskAssignment:
    await lock_task_assignments(session, organization_id, task_id)
    current = await read_current_assignment(session, organization_id, task_id)
    if current is None:
        raise ValidationError("task_id", "No agent is assigned to this task")
    return current


async def stage_stop(
    session: AsyncSession, *, organization_id: UUID, task_id: UUID
) -> StagedAssignment:
    """Stop the run and keep the agent as the task's agent assignee."""
    current = await _require_current(session, organization_id, task_id)
    if current.status not in OPEN_ASSIGNMENT_STATUSES:
        raise ValidationError("task_id", "The agent is not working on this task")
    stopped = _stop(current)
    await session.flush()
    return StagedAssignment(stopped_run_ids=stopped)


async def stage_start(
    session: AsyncSession, *, organization_id: UUID, task_id: UUID, started_by: UUID
) -> StagedAssignment:
    """Start a waiting or scheduled run now, as the person who starts it."""
    current = await _require_current(session, organization_id, task_id)
    held = current.status == TaskAssignmentStatus.WAITING or (
        current.status == TaskAssignmentStatus.PENDING and current.start_at is not None
    )
    if not held:
        raise ValidationError("task_id", "The agent is not waiting to start")
    if current.assigned_by != started_by:
        # A run executes as whoever made it run, so starting someone else's run is a new one.
        return await stage_task_assignment(
            session,
            organization_id=organization_id,
            task_id=task_id,
            agent_id=current.agent_id,
            assigned_by=started_by,
            reason=TaskAssignmentReason.TASK,
        )
    _schedule(current, START_NOW)
    await session.flush()
    return StagedAssignment(assignment_id=current.id)


async def stage_follow_up(
    session: AsyncSession,
    *,
    organization_id: UUID,
    task_id: UUID,
    requested_by: UUID,
    changes: str,
) -> StagedAssignment:
    """Continue the ended run's session with the reviewer's changes as a new run."""
    text = changes.strip()
    if not text:
        raise ValidationError("changes", "Describe the changes")
    if len(text) > MAX_CHANGE_REQUEST_CHARS:
        raise ValidationError(
            "changes", f"Keep the changes under {MAX_CHANGE_REQUEST_CHARS} characters"
        )
    current = await _require_current(session, organization_id, task_id)
    # The session is the assigner's: anyone else continuing it would act as them.
    if current.assigned_by != requested_by:
        raise PermissionDeniedError("request changes from another person's agent run", "task")
    if current.status not in ENDED_ASSIGNMENT_STATUSES or current.session_id is None:
        raise ValidationError("task_id", "The agent has no finished run to change")
    return await stage_task_assignment(
        session,
        organization_id=organization_id,
        task_id=task_id,
        agent_id=current.agent_id,
        assigned_by=requested_by,
        reason=current.reason,
        session_id=current.session_id,
        change_request=text,
    )


async def stage_unassign(
    session: AsyncSession, *, organization_id: UUID, task_id: UUID
) -> StagedAssignment:
    stopped, previous_agent_id = await _retire_current(session, organization_id, task_id)
    return StagedAssignment(stopped_run_ids=stopped, previous_agent_id=previous_agent_id)


async def stage_retire_agent_assignments(
    session: AsyncSession, *, organization_id: UUID, agent_id: UUID
) -> StagedAssignment:
    """A deleted agent stops working everywhere and stops being anyone's assignee."""
    owned = (
        AgentTaskAssignment.organization_id == organization_id,
        AgentTaskAssignment.agent_id == agent_id,
        AgentTaskAssignment.is_current.is_(True),
    )
    stopped = await session.execute(
        update(AgentTaskAssignment)
        .where(*owned, AgentTaskAssignment.status.in_(OPEN_ASSIGNMENT_STATUSES))
        .values(status=TaskAssignmentStatus.STOPPED, ended_at=datetime.now(UTC))
        .returning(AgentTaskAssignment.run_id)
    )
    run_ids = tuple(stopped.scalars().all())
    await session.execute(update(AgentTaskAssignment).where(*owned).values(is_current=False))
    return StagedAssignment(stopped_run_ids=run_ids)


async def after_commit(staged: Iterable[StagedAssignment | None]) -> None:
    """Stop replaced runs, then wake new ones; the recovery schedule covers a missed wake."""
    for item in staged:
        if item is None:
            continue
        for run_id in item.stopped_run_ids:
            try:
                await request_run_cancel(run_id)
            except Exception:
                logger.opt(exception=True).warning("Task run cancel failed for {}", run_id)
        if item.assignment_id is not None and item.wake:
            await wake_task_assignment(item.assignment_id)


async def wake_task_assignment(assignment_id: UUID) -> None:
    try:
        async with asyncio.timeout(WAKE_TIMEOUT_SECONDS):
            await enqueue_job_reconnecting(
                DELIVER_TASK_ASSIGNMENT,
                str(assignment_id),
                _job_id=task_assignment_job_id(assignment_id),
            )
    except Exception:
        logger.warning("Task assignment wakeup deferred for {}", assignment_id)
