"""Worklog writes and reads; every write recomputes the task's time spent in the same transaction."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.core.types import ContentType
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.policy import (
    MINUTES_PER_DAY,
    ResolvedTimePolicy,
    load_time_policy,
)
from uniffy.domains.projects.time.timesheets import TimesheetOperations

logger = logger.bind(component="projects.time.worklogs")

DEFAULT_TASK_PAGE_SIZE = 200
MAX_TASK_PAGE_SIZE = 500
MAX_USER_RANGE_DAYS = 62
MAX_AGGREGATE_RANGE_DAYS = 366
# Clients send the day in their own zone; UTC may sit a day either side of it.
ZONE_TOLERANCE = timedelta(days=1)
# Sources whose entries a person types or a tool writes; imported history is exempt from the caps.
CAPPED_SOURCES = frozenset({WorklogSource.MANUAL, WorklogSource.TIMER, WorklogSource.AGENT})


class AggregateGroupBy(StrEnum):
    DAY = "day"
    TASK = "task"
    USER = "user"
    PROJECT = "project"


@dataclass(frozen=True)
class AggregateRow:
    key: str
    label: str
    minutes: int
    entries: int


@dataclass(frozen=True)
class WorklogRow:
    worklog: Worklog
    project_id: UUID


def _require_enabled(policy: ResolvedTimePolicy) -> None:
    if not policy.enabled:
        raise ValidationError("time_tracking", "time tracking is turned off for this organization")


def _require_duration(duration_minutes: int) -> None:
    if not 1 <= duration_minutes <= MINUTES_PER_DAY:
        raise ValidationError("duration_minutes", f"must be between 1 and {MINUTES_PER_DAY}")


def _require_window(work_date: date, policy: ResolvedTimePolicy) -> None:
    today = datetime.now(UTC).date()
    if not policy.allow_future_dates and work_date > today + ZONE_TOLERANCE:
        raise ValidationError("work_date", "logging time on a future day is not allowed")
    if policy.max_days_back is not None:
        earliest = today - timedelta(days=policy.max_days_back) - ZONE_TOLERANCE
        if work_date < earliest:
            raise ValidationError(
                "work_date", f"entries older than {policy.max_days_back} days cannot be changed"
            )


def _require_range(from_date: date, to_date: date, max_days: int) -> None:
    if to_date < from_date:
        raise ValidationError("to_date", "must not be before from_date")
    if (to_date - from_date).days >= max_days:
        raise ValidationError("to_date", f"range is capped at {max_days} days")


class WorklogOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)

    async def _get(self, organization_id: UUID, worklog_id: UUID) -> WorklogRow:
        result = await self.session.execute(
            select(Worklog, Task.project_id)
            .join(Task, Task.id == Worklog.task_id)
            .where(
                Worklog.id == worklog_id,
                Worklog.organization_id == organization_id,
                Worklog.is_deleted.is_(False),
            )
        )
        row = result.first()
        if row is None:
            raise NotFoundError("Worklog", worklog_id)
        return WorklogRow(worklog=row[0], project_id=row[1])

    async def _require_daily_capacity(
        self,
        organization_id: UUID,
        user_id: UUID,
        work_date: date,
        duration_minutes: int,
        *,
        exclude_id: UUID | None = None,
    ) -> None:
        query = select(func.coalesce(func.sum(Worklog.duration_minutes), 0)).where(
            Worklog.organization_id == organization_id,
            Worklog.user_id == user_id,
            Worklog.work_date == work_date,
            Worklog.is_deleted.is_(False),
        )
        if exclude_id is not None:
            query = query.where(Worklog.id != exclude_id)
        logged = int((await self.session.execute(query)).scalar_one())
        if logged + duration_minutes > MINUTES_PER_DAY:
            raise ValidationError(
                "duration_minutes",
                f"this would put the day at {logged + duration_minutes} minutes; "
                f"a day holds at most {MINUTES_PER_DAY}",
            )

    async def _require_unlocked(
        self, actor_id: UUID, organization_id: UUID, user_id: UUID, work_date: date
    ) -> bool:
        """False when open; True when a timekeeping admin overrides a lock; raises otherwise."""
        if not await TimesheetOperations(self.session).is_locked(
            organization_id, user_id, work_date
        ):
            return False
        if await self.access.is_timekeeping_admin(actor_id, organization_id):
            return True
        raise ValidationError(
            "work_date", f"{work_date.isoformat()} is locked; recall or reopen the period first"
        )

    async def _require_own_or_reviewer(
        self, actor_id: UUID, organization_id: UUID, worklog: Worklog
    ) -> bool:
        """True when the actor changes someone else's entry as a reviewer or timekeeping admin."""
        await self.access.require_active_actor(actor_id, organization_id)
        if actor_id == worklog.user_id:
            return False
        if await self.access.is_reviewer_of(
            actor_id, organization_id, worklog.user_id
        ) or await self.access.is_timekeeping_admin(actor_id, organization_id):
            return True
        raise PermissionDeniedError("change another person's time entry")

    async def stage_task_rollup(self, task_id: UUID) -> int:
        """Set the task's time spent to the sum of its live entries; NULL at zero. Never commits."""
        live_sum = (
            select(func.nullif(func.coalesce(func.sum(Worklog.duration_minutes), 0), 0))
            .where(Worklog.task_id == task_id, Worklog.is_deleted.is_(False))
            .scalar_subquery()
        )
        result = await self.session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                time_spent_minutes=live_sum,
                version=Task.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(Task.time_spent_minutes)
        )
        return int(result.scalar_one() or 0)

    async def _write_audit(
        self,
        *,
        organization_id: UUID,
        actor_id: UUID,
        action: Action,
        worklog: Worklog,
    ) -> None:
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=actor_id,
            action=action,
            resource_type=AuditResourceType.WORKLOG,
            resource_id=worklog.id,
            details={
                "task_id": str(worklog.task_id),
                "user_id": str(worklog.user_id),
                "work_date": worklog.work_date.isoformat(),
                "duration_minutes": worklog.duration_minutes,
            },
            on_behalf_of_user_id=worklog.user_id if worklog.user_id != actor_id else None,
        )

    async def create(
        self,
        actor_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        *,
        work_date: date,
        duration_minutes: int,
        user_id: UUID | None = None,
        description: str = "",
        started_at: datetime | None = None,
        source: WorklogSource = WorklogSource.MANUAL,
    ) -> tuple[WorklogRow, int]:
        policy = await load_time_policy(self.session, organization_id)
        _require_enabled(policy)
        task = await self.access.require_task_view(actor_id, organization_id, task_id)
        subject_id = user_id or actor_id
        on_behalf = subject_id != actor_id
        if on_behalf:
            if not policy.allow_log_for_others:
                raise PermissionDeniedError("log time for someone else")
            if not (
                await self.access.is_reviewer_of(actor_id, organization_id, subject_id)
                or await self.access.is_timekeeping_admin(actor_id, organization_id)
            ):
                raise PermissionDeniedError("log time for someone you do not review")
            await self.access.require_active_member(subject_id, organization_id)
        if source in CAPPED_SOURCES:
            _require_duration(duration_minutes)
            _require_window(work_date, policy)
            await self._require_daily_capacity(
                organization_id, subject_id, work_date, duration_minutes
            )
        override = await self._require_unlocked(actor_id, organization_id, subject_id, work_date)

        worklog = Worklog(
            organization_id=organization_id,
            task_id=task.id,
            user_id=subject_id,
            created_by_user_id=actor_id,
            work_date=work_date,
            started_at=started_at,
            duration_minutes=duration_minutes,
            description=description or "",
            source=source,
        )
        self.session.add(worklog)
        await self.session.flush()
        rollup = await self.stage_task_rollup(task.id)
        await TaskNotifications(self.session).log_activity(
            task.id, actor_id, "time_logged", new_value=str(duration_minutes)
        )
        if on_behalf or override:
            await self._write_audit(
                organization_id=organization_id,
                actor_id=actor_id,
                action=Action.WORKLOG_OVERRIDE if override else Action.WORKLOG_CREATED,
                worklog=worklog,
            )
        task_id, project_id = task.id, task.project_id
        await self.session.commit()
        await publish_content_changed(ContentType.TASK, task_id, organization_id)
        return WorklogRow(worklog=worklog, project_id=project_id), rollup

    async def update(
        self,
        actor_id: UUID,
        organization_id: UUID,
        worklog_id: UUID,
        *,
        work_date: date | None = None,
        duration_minutes: int | None = None,
        description: str | None = None,
    ) -> tuple[WorklogRow, int]:
        policy = await load_time_policy(self.session, organization_id)
        _require_enabled(policy)
        row = await self._get(organization_id, worklog_id)
        worklog = row.worklog
        on_behalf = await self._require_own_or_reviewer(actor_id, organization_id, worklog)
        new_date = work_date or worklog.work_date
        new_minutes = duration_minutes if duration_minutes is not None else worklog.duration_minutes
        if worklog.source in CAPPED_SOURCES:
            _require_duration(new_minutes)
            if work_date is not None:
                _require_window(new_date, policy)
            await self._require_daily_capacity(
                organization_id, worklog.user_id, new_date, new_minutes, exclude_id=worklog.id
            )
        override = await self._require_unlocked(
            actor_id, organization_id, worklog.user_id, worklog.work_date
        )
        if new_date != worklog.work_date:
            override = (
                await self._require_unlocked(actor_id, organization_id, worklog.user_id, new_date)
                or override
            )

        previous_minutes = worklog.duration_minutes
        worklog.work_date = new_date
        worklog.duration_minutes = new_minutes
        if description is not None:
            worklog.description = description
        await self.session.flush()
        rollup = await self.stage_task_rollup(worklog.task_id)
        await TaskNotifications(self.session).log_activity(
            worklog.task_id,
            actor_id,
            "time_updated",
            previous_value=str(previous_minutes),
            new_value=str(new_minutes),
        )
        if on_behalf or override:
            await self._write_audit(
                organization_id=organization_id,
                actor_id=actor_id,
                action=Action.WORKLOG_OVERRIDE if override else Action.WORKLOG_UPDATED,
                worklog=worklog,
            )
        task_id = worklog.task_id
        await self.session.commit()
        await publish_content_changed(ContentType.TASK, task_id, organization_id)
        return row, rollup

    async def delete(
        self, actor_id: UUID, organization_id: UUID, worklog_id: UUID
    ) -> tuple[UUID, int]:
        """Soft delete; returns the task id and its new rollup."""
        worklog = (await self._get(organization_id, worklog_id)).worklog
        on_behalf = await self._require_own_or_reviewer(actor_id, organization_id, worklog)
        override = await self._require_unlocked(
            actor_id, organization_id, worklog.user_id, worklog.work_date
        )
        worklog.is_deleted = True
        worklog.deleted_at = datetime.now(UTC)
        await self.session.flush()
        rollup = await self.stage_task_rollup(worklog.task_id)
        await TaskNotifications(self.session).log_activity(
            worklog.task_id,
            actor_id,
            "time_removed",
            previous_value=str(worklog.duration_minutes),
        )
        if on_behalf or override:
            await self._write_audit(
                organization_id=organization_id,
                actor_id=actor_id,
                action=Action.WORKLOG_OVERRIDE if override else Action.WORKLOG_DELETED,
                worklog=worklog,
            )
        task_id = worklog.task_id
        await self.session.commit()
        await publish_content_changed(ContentType.TASK, task_id, organization_id)
        return task_id, rollup

    async def list_for_task(
        self,
        actor_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        *,
        page_size: int = DEFAULT_TASK_PAGE_SIZE,
        page_token: str = "",
    ) -> tuple[list[WorklogRow], str]:
        task = await self.access.require_task_view(actor_id, organization_id, task_id)
        size = min(page_size or DEFAULT_TASK_PAGE_SIZE, MAX_TASK_PAGE_SIZE)
        offset = _parse_offset(page_token)
        result = await self.session.execute(
            select(Worklog)
            .where(
                Worklog.organization_id == organization_id,
                Worklog.task_id == task.id,
                Worklog.is_deleted.is_(False),
            )
            .order_by(Worklog.work_date.desc(), Worklog.created_at.desc())
            .offset(offset)
            .limit(size + 1)
        )
        rows = list(result.scalars().all())
        next_token = str(offset + size) if len(rows) > size else ""
        return [
            WorklogRow(worklog=row, project_id=task.project_id) for row in rows[:size]
        ], next_token

    async def list_for_user(
        self,
        actor_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        *,
        from_date: date,
        to_date: date,
    ) -> list[WorklogRow]:
        _require_range(from_date, to_date, MAX_USER_RANGE_DAYS)
        await self.access.require_person_scope(actor_id, organization_id, user_id)
        result = await self.session.execute(
            select(Worklog, Task.project_id)
            .join(Task, Task.id == Worklog.task_id)
            .where(
                Worklog.organization_id == organization_id,
                Worklog.user_id == user_id,
                Worklog.is_deleted.is_(False),
                Worklog.work_date >= from_date,
                Worklog.work_date <= to_date,
            )
            .order_by(Worklog.work_date.asc(), Worklog.created_at.asc())
        )
        return [WorklogRow(worklog=row[0], project_id=row[1]) for row in result.all()]

    async def aggregate(
        self,
        actor_id: UUID,
        organization_id: UUID,
        *,
        from_date: date,
        to_date: date,
        group_by: AggregateGroupBy,
        project_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> list[AggregateRow]:
        """One GROUP BY over the range, gated by project view or person scope."""
        _require_range(from_date, to_date, MAX_AGGREGATE_RANGE_DAYS)
        if project_id is None and user_id is None:
            raise ValidationError("scope", "a project or a person is required")
        if project_id is not None:
            await self.access.require_project_view(actor_id, organization_id, project_id)
        if user_id is not None:
            await self.access.require_person_scope(actor_id, organization_id, user_id)

        minutes = func.coalesce(func.sum(Worklog.duration_minutes), 0).label("minutes")
        entries = func.count(Worklog.id).label("entries")
        if group_by is AggregateGroupBy.DAY:
            key, label = Worklog.work_date, Worklog.work_date
        elif group_by is AggregateGroupBy.TASK:
            key, label = Task.id, Task.title
        elif group_by is AggregateGroupBy.USER:
            key, label = Worklog.user_id, func.coalesce(User.full_name, User.email)
        else:
            key, label = Project.id, Project.name

        query = (
            select(key.label("key"), label.label("label"), minutes, entries)
            .select_from(Worklog)
            .join(Task, Task.id == Worklog.task_id)
            .where(
                Worklog.organization_id == organization_id,
                Worklog.is_deleted.is_(False),
                Worklog.work_date >= from_date,
                Worklog.work_date <= to_date,
            )
        )
        if group_by is AggregateGroupBy.USER:
            query = query.join(User, User.id == Worklog.user_id)
        if group_by is AggregateGroupBy.PROJECT:
            query = query.join(Project, Project.id == Task.project_id)
        if project_id is not None:
            query = query.where(Task.project_id == project_id)
        if user_id is not None:
            query = query.where(Worklog.user_id == user_id)
        query = query.group_by(key, label).order_by(
            key.asc() if group_by is AggregateGroupBy.DAY else minutes.desc()
        )
        result = await self.session.execute(query)
        return [
            AggregateRow(
                key=row.key.isoformat() if isinstance(row.key, date) else str(row.key),
                label=row.label.isoformat() if isinstance(row.label, date) else str(row.label),
                minutes=int(row.minutes),
                entries=int(row.entries),
            )
            for row in result.all()
        ]


def _parse_offset(page_token: str) -> int:
    if not page_token:
        return 0
    try:
        offset = int(page_token)
    except ValueError as exc:
        raise ValidationError("page_token", "invalid page token") from exc
    if offset < 0:
        raise ValidationError("page_token", "invalid page token")
    return offset
