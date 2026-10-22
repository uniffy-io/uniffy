"""Timesheets: the approval state of one person's period, and the locks it puts on their days."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.capacity import day_requirements_for
from uniffy.domains.projects.time.events import (
    notify_grace,
    notify_reviewed,
    notify_submitted,
)
from uniffy.domains.projects.time.locks import (
    PENDING_STATUSES,
    period_is_closed,
    sheet_is_locked,
    sheet_row,
)
from uniffy.domains.projects.time.periods import period_for, period_is_lock_due
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, load_time_policy

logger = logger.bind(component="projects.time.timesheets")

MAX_GRACE_HOURS = 336


class RecallCause(StrEnum):
    MANUAL = "manual"
    EDIT = "edit"


@dataclass(frozen=True)
class SheetView:
    timesheet: Timesheet | None
    user_id: UUID
    period_start: date
    period_end: date
    status: TimesheetStatus
    locked: bool
    period_closed: bool
    can_review: bool
    total_minutes: int
    required_minutes: int


def _require_approvals(policy: ResolvedTimePolicy) -> None:
    if not policy.enabled:
        raise ValidationError("time_tracking", "time tracking is turned off for this organization")
    if not policy.approvals_enabled:
        raise ValidationError("approvals", "timesheet approvals are turned off")


class TimesheetOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)

    async def _sheet_by_id(self, organization_id: UUID, timesheet_id: UUID) -> Timesheet:
        result = await self.session.execute(
            select(Timesheet).where(
                Timesheet.id == timesheet_id, Timesheet.organization_id == organization_id
            )
        )
        sheet = result.scalars().first()
        if sheet is None:
            raise NotFoundError("Timesheet", timesheet_id)
        return sheet

    async def _require_open_period(self, organization_id: UUID, start: date, end: date) -> None:
        if await period_is_closed(self.session, organization_id, start):
            raise ValidationError(
                "period",
                f"the period {start.isoformat()} to {end.isoformat()} is closed; reopen it first",
            )

    async def stage_after_write(
        self,
        actor_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        work_date: date,
        *,
        policy: ResolvedTimePolicy,
    ) -> None:
        """An entry changed under a pending sheet: approved returns for review, submitted recalls."""
        if not policy.approvals_enabled:
            return
        start, _ = period_for(work_date, policy)
        sheet = await sheet_row(self.session, organization_id, user_id, start)
        if sheet is None:
            return
        if sheet.status == TimesheetStatus.APPROVED:
            sheet.status = TimesheetStatus.SUBMITTED
            sheet.reviewed_at = None
            sheet.review_comment = ""
            await self._audit(
                sheet,
                actor_id,
                Action.TIMESHEET_SUBMITTED,
                {"cause": RecallCause.EDIT, "previous_status": TimesheetStatus.APPROVED},
            )
        elif sheet.status == TimesheetStatus.SUBMITTED and not policy.lock_on_submit:
            await self.stage_recall(sheet, actor_id, RecallCause.EDIT)

    async def _audit(
        self, sheet: Timesheet, actor_id: UUID | None, action: Action, details: dict | None = None
    ) -> None:
        await write_audit_event(
            self.session,
            organization_id=sheet.organization_id,
            actor_user_id=actor_id,
            action=action,
            resource_type=AuditResourceType.TIMESHEET,
            resource_id=sheet.id,
            details={
                "user_id": str(sheet.user_id),
                "period_start": sheet.period_start.isoformat(),
                "period_end": sheet.period_end.isoformat(),
                **(details or {}),
            },
            on_behalf_of_user_id=sheet.user_id if sheet.user_id != actor_id else None,
        )

    async def _view(
        self,
        actor_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        start: date,
        end: date,
        *,
        policy: ResolvedTimePolicy,
        sheet: Timesheet | None,
    ) -> SheetView:
        now = datetime.now(UTC)
        period_closed = await period_is_closed(self.session, organization_id, start)
        total = await self.session.execute(
            select(func.coalesce(func.sum(Worklog.duration_minutes), 0)).where(
                Worklog.organization_id == organization_id,
                Worklog.user_id == user_id,
                Worklog.is_deleted.is_(False),
                Worklog.work_date >= start,
                Worklog.work_date <= end,
            )
        )
        requirements = await day_requirements_for(
            self.session, organization_id, [user_id], start, end, policy
        )
        can_review = actor_id != user_id and await self.access.is_reviewer_of(
            actor_id, organization_id, user_id
        )
        return SheetView(
            timesheet=sheet,
            user_id=user_id,
            period_start=start,
            period_end=end,
            status=sheet.status if sheet is not None else TimesheetStatus.OPEN,
            locked=sheet_is_locked(
                sheet, period_closed=period_closed, period_end=end, policy=policy, now=now
            ),
            period_closed=period_closed,
            can_review=can_review,
            total_minutes=int(total.scalar_one()),
            required_minutes=sum(item.required_minutes for item in requirements[user_id]),
        )

    async def get(
        self, actor_id: UUID, organization_id: UUID, user_id: UUID, day: date
    ) -> SheetView:
        await self.access.require_person_scope(actor_id, organization_id, user_id)
        policy = await load_time_policy(self.session, organization_id)
        start, end = period_for(day, policy)
        sheet = await sheet_row(self.session, organization_id, user_id, start)
        return await self._view(
            actor_id, organization_id, user_id, start, end, policy=policy, sheet=sheet
        )

    async def _require_reviewer(
        self, actor_id: UUID, organization_id: UUID, subject_id: UUID
    ) -> None:
        await self.access.require_active_actor(actor_id, organization_id)
        if actor_id == subject_id:
            raise PermissionDeniedError("review your own timesheet")
        if not await self.access.is_reviewer_of(actor_id, organization_id, subject_id):
            raise PermissionDeniedError("review this person's timesheet")

    async def stage_submit(
        self,
        actor_id: UUID | None,
        organization_id: UUID,
        user_id: UUID,
        day: date,
        *,
        comment: str,
        policy: ResolvedTimePolicy,
        now: datetime | None = None,
    ) -> Timesheet:
        """Move the sheet to SUBMITTED; a missing actor means the period job did it."""
        now = now or datetime.now(UTC)
        start, end = period_for(day, policy)
        await self._require_open_period(organization_id, start, end)
        sheet = await sheet_row(self.session, organization_id, user_id, start)
        if sheet is None:
            sheet = Timesheet(
                organization_id=organization_id, user_id=user_id, period_start=start, period_end=end
            )
            self.session.add(sheet)
        elif sheet.status in PENDING_STATUSES:
            raise ValidationError("timesheet", "this period is already submitted")
        sheet.status = TimesheetStatus.SUBMITTED
        sheet.submitted_at = now
        sheet.submitted_by_user_id = actor_id
        sheet.submit_comment = comment or ""
        sheet.reviewer_user_id = None
        sheet.reviewed_at = None
        sheet.review_comment = ""
        await self.session.flush()
        await self._audit(sheet, actor_id, Action.TIMESHEET_SUBMITTED, {"comment": comment or ""})
        return sheet

    async def submit(
        self,
        actor_id: UUID,
        organization_id: UUID,
        user_id: UUID | None,
        day: date,
        *,
        comment: str = "",
        policy: ResolvedTimePolicy | None = None,
    ) -> SheetView:
        policy = policy or await load_time_policy(self.session, organization_id)
        _require_approvals(policy)
        subject_id = user_id or actor_id
        if subject_id == actor_id:
            await self.access.require_active_actor(actor_id, organization_id)
        else:
            await self._require_reviewer(actor_id, organization_id, subject_id)
            await self.access.require_active_member(subject_id, organization_id)
        sheet = await self.stage_submit(
            actor_id, organization_id, subject_id, day, comment=comment, policy=policy
        )
        await self.session.commit()
        await notify_submitted(self.session, sheet, actor_id)
        return await self._view(
            actor_id,
            organization_id,
            subject_id,
            sheet.period_start,
            sheet.period_end,
            policy=policy,
            sheet=sheet,
        )

    async def stage_recall(self, sheet: Timesheet, actor_id: UUID, cause: RecallCause) -> None:
        sheet.status = TimesheetStatus.OPEN
        sheet.submitted_at = None
        sheet.submitted_by_user_id = None
        sheet.submit_comment = ""
        sheet.reviewer_user_id = None
        sheet.reviewed_at = None
        sheet.review_comment = ""
        await self.session.flush()
        await self._audit(sheet, actor_id, Action.TIMESHEET_RECALLED, {"cause": cause})

    async def recall(
        self, actor_id: UUID, organization_id: UUID, user_id: UUID | None, day: date
    ) -> SheetView:
        policy = await load_time_policy(self.session, organization_id)
        _require_approvals(policy)
        subject_id = user_id or actor_id
        if subject_id == actor_id:
            await self.access.require_active_actor(actor_id, organization_id)
        else:
            await self._require_reviewer(actor_id, organization_id, subject_id)
        start, end = period_for(day, policy)
        await self._require_open_period(organization_id, start, end)
        sheet = await sheet_row(self.session, organization_id, subject_id, start)
        if sheet is None or sheet.status != TimesheetStatus.SUBMITTED:
            raise ValidationError("timesheet", "only a submitted timesheet can be recalled")
        await self.stage_recall(sheet, actor_id, RecallCause.MANUAL)
        await self.session.commit()
        return await self._view(
            actor_id, organization_id, subject_id, start, end, policy=policy, sheet=sheet
        )

    async def _review(
        self,
        actor_id: UUID,
        organization_id: UUID,
        timesheet_id: UUID,
        *,
        comment: str,
        approve: bool,
    ) -> SheetView:
        policy = await load_time_policy(self.session, organization_id)
        _require_approvals(policy)
        sheet = await self._sheet_by_id(organization_id, timesheet_id)
        await self._require_reviewer(actor_id, organization_id, sheet.user_id)
        await self._require_open_period(organization_id, sheet.period_start, sheet.period_end)
        if sheet.status != TimesheetStatus.SUBMITTED:
            raise ValidationError("timesheet", "only a submitted timesheet can be reviewed")
        if not approve and not comment.strip():
            raise ValidationError("comment", "a reason is required to reject a timesheet")
        now = datetime.now(UTC)
        sheet.status = TimesheetStatus.APPROVED if approve else TimesheetStatus.REJECTED
        sheet.reviewer_user_id = actor_id
        sheet.reviewed_at = now
        sheet.review_comment = comment.strip()
        if approve:
            sheet.grace_until = None
        elif period_is_lock_due(sheet.period_end, now.date(), policy):
            # The worker needs room to fix what was rejected once the period has locked.
            sheet.grace_until = now + timedelta(days=max(1, policy.period_lock_delay_days))
        await self.session.flush()
        await self._audit(
            sheet,
            actor_id,
            Action.TIMESHEET_APPROVED if approve else Action.TIMESHEET_REJECTED,
            {"comment": sheet.review_comment},
        )
        await self.session.commit()
        await notify_reviewed(sheet, actor_id, approved=approve)
        return await self._view(
            actor_id,
            organization_id,
            sheet.user_id,
            sheet.period_start,
            sheet.period_end,
            policy=policy,
            sheet=sheet,
        )

    async def approve(
        self, actor_id: UUID, organization_id: UUID, timesheet_id: UUID, *, comment: str = ""
    ) -> SheetView:
        return await self._review(
            actor_id, organization_id, timesheet_id, comment=comment, approve=True
        )

    async def reject(
        self, actor_id: UUID, organization_id: UUID, timesheet_id: UUID, *, comment: str
    ) -> SheetView:
        return await self._review(
            actor_id, organization_id, timesheet_id, comment=comment, approve=False
        )

    async def grant_grace(
        self, actor_id: UUID, organization_id: UUID, user_id: UUID, day: date, *, hours: int
    ) -> SheetView:
        policy = await load_time_policy(self.session, organization_id)
        _require_approvals(policy)
        if not 1 <= hours <= MAX_GRACE_HOURS:
            raise ValidationError("hours", f"must be between 1 and {MAX_GRACE_HOURS}")
        await self._require_reviewer(actor_id, organization_id, user_id)
        await self.access.require_active_member(user_id, organization_id)
        start, end = period_for(day, policy)
        await self._require_open_period(organization_id, start, end)
        sheet = await sheet_row(self.session, organization_id, user_id, start)
        if sheet is None:
            sheet = Timesheet(
                organization_id=organization_id, user_id=user_id, period_start=start, period_end=end
            )
            self.session.add(sheet)
        now = datetime.now(UTC)
        sheet.grace_until = now + timedelta(hours=hours)
        await self.session.flush()
        await self._audit(
            sheet,
            actor_id,
            Action.TIMESHEET_GRACE_GRANTED,
            {"hours": hours, "grace_until": sheet.grace_until.isoformat()},
        )
        await self.session.commit()
        await notify_grace(sheet, actor_id, hours)
        return await self._view(
            actor_id, organization_id, user_id, start, end, policy=policy, sheet=sheet
        )
