"""Timers: one running or paused timer per person and organization, stopped into a worklog."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.realtime import (
    NotificationPayloadType,
    publish_content_changed,
    publish_notification,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.timer import Timer, TimerPauseReason
from uniffy.core.models.projects.worklog import WorklogSource
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.policy import (
    ResolvedTimePolicy,
    load_time_policy,
    require_enabled,
)
from uniffy.domains.projects.time.worklogs import WorklogOperations, WorklogRow

logger = logger.bind(component="projects.time.timers")

SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600


def round_minutes(seconds: int, increment: int) -> int:
    """Round half up to the increment, never below one increment."""
    if increment <= 0:
        raise ValueError("increment must be positive")
    half_increment_seconds = increment * SECONDS_PER_MINUTE // 2
    units = (max(seconds, 0) + half_increment_seconds) // (increment * SECONDS_PER_MINUTE)
    return max(increment, units * increment)


def elapsed_seconds(timer: Timer, now: datetime) -> int:
    running = int((now - timer.started_at).total_seconds()) if timer.started_at else 0
    return timer.accumulated_seconds + max(running, 0)


def stage_pause(timer: Timer, now: datetime, reason: TimerPauseReason | None = None) -> None:
    """Fold the running segment into the total; a limit reason sticks so the job applies it once."""
    timer.accumulated_seconds = elapsed_seconds(timer, now)
    timer.started_at = None
    timer.paused_at = now
    if reason is not None:
        timer.pause_reason = reason
    timer.updated_at = now


@dataclass(frozen=True)
class TimerRow:
    timer: Timer
    project_id: UUID
    project_slug: str
    task_title: str
    task_number: int


@dataclass(frozen=True)
class StopResult:
    task_id: UUID
    worklog: WorklogRow | None
    task_time_spent_minutes: int


def timer_changed_payload(organization_id: UUID) -> dict[str, str]:
    return {"_type": NotificationPayloadType.TIMER_CHANGED, "organization_id": str(organization_id)}


class TimerOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)
        self.worklogs = WorklogOperations(session)

    async def _get(self, organization_id: UUID, user_id: UUID) -> TimerRow | None:
        result = await self.session.execute(
            select(Timer, Task.project_id, Project.slug, Task.title, Task.number)
            .join(Task, Task.id == Timer.task_id)
            .join(Project, Project.id == Task.project_id)
            .where(Timer.organization_id == organization_id, Timer.user_id == user_id)
        )
        row = result.first()
        if row is None:
            return None
        timer, project_id, project_slug, task_title, task_number = row
        return TimerRow(
            timer=timer,
            project_id=project_id,
            project_slug=project_slug,
            task_title=task_title,
            task_number=task_number,
        )

    async def _require(self, organization_id: UUID, user_id: UUID) -> TimerRow:
        row = await self._get(organization_id, user_id)
        if row is None:
            raise NotFoundError("timer", "no timer is running")
        return row

    async def get_active(self, actor_id: UUID, organization_id: UUID) -> TimerRow | None:
        await self.access.require_active_actor(actor_id, organization_id)
        return await self._get(organization_id, actor_id)

    async def start(
        self,
        actor_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        *,
        work_date: date,
        description: str = "",
    ) -> tuple[TimerRow, StopResult | None]:
        """A running timer is stopped into a worklog on work_date in the same transaction."""
        policy = await load_time_policy(self.session, organization_id)
        require_enabled(policy)
        await self.access.require_active_actor(actor_id, organization_id)
        task = await self.access.require_task_view(actor_id, organization_id, task_id)
        replaced: StopResult | None = None
        existing = await self._get(organization_id, actor_id)
        if existing is not None:
            replaced = await self._stage_stop(
                existing, actor_id, organization_id, policy, work_date=work_date
            )
        now = datetime.now(UTC)
        self.session.add(
            Timer(
                organization_id=organization_id,
                user_id=actor_id,
                task_id=task.id,
                description=description or "",
                started_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        await self.session.flush()
        row = await self._require(organization_id, actor_id)
        await self.session.commit()
        await publish_notification(
            actor_id, timer_changed_payload(organization_id), organization_id=organization_id
        )
        if replaced is not None and replaced.worklog is not None:
            await publish_content_changed(ContentType.TASK, replaced.task_id, organization_id)
        return row, replaced

    async def stage_stop_active(
        self,
        actor_id: UUID,
        organization_id: UUID,
        policy: ResolvedTimePolicy,
        *,
        work_date: date,
    ) -> StopResult | None:
        """Stop the person's timer into a worklog without committing; None when nothing runs."""
        row = await self._get(organization_id, actor_id)
        if row is None:
            return None
        return await self._stage_stop(row, actor_id, organization_id, policy, work_date=work_date)

    async def pause(self, actor_id: UUID, organization_id: UUID) -> TimerRow:
        await self.access.require_active_actor(actor_id, organization_id)
        row = await self._require(organization_id, actor_id)
        if row.timer.started_at is None:
            raise ValidationError("timer", "the timer is already paused")
        stage_pause(row.timer, datetime.now(UTC))
        await self.session.commit()
        await publish_notification(
            actor_id, timer_changed_payload(organization_id), organization_id=organization_id
        )
        return row

    async def resume(self, actor_id: UUID, organization_id: UUID) -> TimerRow:
        await self.access.require_active_actor(actor_id, organization_id)
        row = await self._require(organization_id, actor_id)
        timer = row.timer
        if timer.started_at is not None:
            raise ValidationError("timer", "the timer is already running")
        now = datetime.now(UTC)
        timer.started_at = now
        timer.paused_at = None
        timer.updated_at = now
        await self.session.commit()
        await publish_notification(
            actor_id, timer_changed_payload(organization_id), organization_id=organization_id
        )
        return row

    async def stop(
        self,
        actor_id: UUID,
        organization_id: UUID,
        *,
        work_date: date | None,
        description: str | None = None,
        duration_minutes: int | None = None,
        discard: bool = False,
    ) -> StopResult:
        """Writes a timer-sourced worklog unless discarded; a discard works with tracking off."""
        policy = await load_time_policy(self.session, organization_id)
        await self.access.require_active_actor(actor_id, organization_id)
        row = await self._require(organization_id, actor_id)
        result = await self._stage_stop(
            row,
            actor_id,
            organization_id,
            policy,
            work_date=work_date,
            description=description,
            duration_minutes=duration_minutes,
            discard=discard,
        )
        await self.session.commit()
        await publish_notification(
            actor_id, timer_changed_payload(organization_id), organization_id=organization_id
        )
        if result.worklog is not None:
            await publish_content_changed(ContentType.TASK, result.task_id, organization_id)
        return result

    async def _stage_stop(
        self,
        row: TimerRow,
        actor_id: UUID,
        organization_id: UUID,
        policy: ResolvedTimePolicy,
        *,
        work_date: date | None,
        description: str | None = None,
        duration_minutes: int | None = None,
        discard: bool = False,
    ) -> StopResult:
        timer = row.timer
        task_id = timer.task_id
        worklog: WorklogRow | None = None
        rollup: int | None = None
        if not discard:
            if work_date is None:
                raise ValidationError("work_date", "the day to log the timer on is required")
            minutes = (
                duration_minutes
                if duration_minutes is not None
                else round_minutes(
                    elapsed_seconds(timer, datetime.now(UTC)), policy.timer_rounding_minutes
                )
            )
            worklog, rollup = await self.worklogs.stage_create(
                actor_id,
                organization_id,
                task_id,
                work_date=work_date,
                duration_minutes=minutes,
                description=description if description is not None else timer.description,
                started_at=timer.created_at,
                source=WorklogSource.TIMER,
                policy=policy,
            )
        await self.session.delete(timer)
        await self.session.flush()
        if rollup is None:
            current = await self.session.execute(
                select(Task.time_spent_minutes).where(Task.id == task_id)
            )
            rollup = current.scalar_one() or 0
        return StopResult(task_id=task_id, worklog=worklog, task_time_spent_minutes=rollup)


async def pause_timers_past_limit(session: AsyncSession, now: datetime | None = None) -> int:
    """Pause every running timer past its organization's limit once and tell its owner."""
    now = now or datetime.now(UTC)
    result = await session.execute(
        select(Timer, Task.title)
        .join(Task, Task.id == Timer.task_id)
        .where(Timer.started_at.is_not(None), Timer.pause_reason.is_(None))
    )
    policies: dict[UUID, ResolvedTimePolicy] = {}
    paused: list[tuple[Timer, str, int]] = []
    for timer, task_title in result.all():
        if timer.started_at is None or timer.pause_reason is not None:
            continue
        policy = policies.get(timer.organization_id)
        if policy is None:
            policy = await load_time_policy(session, timer.organization_id)
            policies[timer.organization_id] = policy
        if elapsed_seconds(timer, now) < policy.max_timer_hours * SECONDS_PER_HOUR:
            continue
        stage_pause(timer, now, TimerPauseReason.LIMIT)
        paused.append((timer, task_title, policy.max_timer_hours))
    if not paused:
        return 0
    await session.commit()
    for timer, task_title, limit_hours in paused:
        await publish_notification(
            timer.user_id,
            timer_changed_payload(timer.organization_id),
            organization_id=timer.organization_id,
        )
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TIMER_LIMIT_REACHED,
                organization_id=timer.organization_id,
                actor_id=None,
                title=f"Timer paused after {limit_hours}h: {task_title}",
                body="Stop it to log the time, or resume if you are still working.",
                source_urn=build_content_urn(ContentType.TASK, timer.task_id),
                target_user_ids=[timer.user_id],
            )
        )
    logger.info(f"Paused {len(paused)} timer(s) past the organization limit")
    return len(paused)
