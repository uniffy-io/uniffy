"""Which days refuse writes: closed periods, pending sheets and ended periods past their delay."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.timesheet import (
    TimePeriod,
    TimePeriodStatus,
    Timesheet,
    TimesheetStatus,
)
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.periods import period_for, period_is_lock_due
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, load_time_policy

PENDING_STATUSES = (TimesheetStatus.SUBMITTED, TimesheetStatus.APPROVED)


def sheet_is_locked(
    sheet: Timesheet | None,
    *,
    period_closed: bool,
    period_end: date,
    policy: ResolvedTimePolicy,
    now: datetime,
) -> bool:
    """A closed period always locks; otherwise grace beats submission, which beats the ended rule."""
    if period_closed:
        return True
    if not policy.approvals_enabled:
        return False
    if sheet is not None and sheet.grace_until is not None and sheet.grace_until > now:
        return False
    if sheet is not None and sheet.status in PENDING_STATUSES and policy.lock_on_submit:
        return True
    return period_is_lock_due(period_end, now.date(), policy)


async def period_row(session: AsyncSession, organization_id: UUID, start: date) -> TimePeriod | None:
    result = await session.execute(
        select(TimePeriod).where(
            TimePeriod.organization_id == organization_id, TimePeriod.start_date == start
        )
    )
    return result.scalars().first()


async def period_is_closed(session: AsyncSession, organization_id: UUID, start: date) -> bool:
    row = await period_row(session, organization_id, start)
    return row is not None and row.status == TimePeriodStatus.CLOSED


async def sheet_row(
    session: AsyncSession, organization_id: UUID, user_id: UUID, start: date
) -> Timesheet | None:
    result = await session.execute(
        select(Timesheet).where(
            Timesheet.organization_id == organization_id,
            Timesheet.user_id == user_id,
            Timesheet.period_start == start,
        )
    )
    return result.scalars().first()


class SheetLocks:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def is_locked(
        self,
        organization_id: UUID,
        user_id: UUID,
        work_date: date,
        *,
        policy: ResolvedTimePolicy | None = None,
        now: datetime | None = None,
    ) -> bool:
        policy = policy or await load_time_policy(self.session, organization_id)
        now = now or datetime.now(UTC)
        start, end = period_for(work_date, policy)
        if await period_is_closed(self.session, organization_id, start):
            return True
        if not policy.approvals_enabled:
            return False
        sheet = await sheet_row(self.session, organization_id, user_id, start)
        return sheet_is_locked(sheet, period_closed=False, period_end=end, policy=policy, now=now)

    async def locked_periods_for_tasks(
        self, organization_id: UUID, task_ids: list[UUID]
    ) -> list[tuple[date, date]]:
        """Periods holding a locked entry on any of the tasks, earliest first."""
        policy = await load_time_policy(self.session, organization_id)
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(Worklog.user_id, Worklog.work_date)
            .where(Worklog.task_id.in_(task_ids), Worklog.is_deleted.is_(False))
            .distinct()
        )
        pairs = {(user_id, period_for(day, policy)) for user_id, day in result.all()}
        if not pairs:
            return []
        starts = sorted({period[0] for _, period in pairs})
        closed = await self.session.execute(
            select(TimePeriod.start_date).where(
                TimePeriod.organization_id == organization_id,
                TimePeriod.start_date.in_(starts),
                TimePeriod.status == TimePeriodStatus.CLOSED,
            )
        )
        closed_starts = {row[0] for row in closed.all()}
        sheets: dict[tuple[UUID, date], Timesheet] = {}
        if policy.approvals_enabled:
            found = await self.session.execute(
                select(Timesheet).where(
                    Timesheet.organization_id == organization_id,
                    tuple_(Timesheet.user_id, Timesheet.period_start).in_([
                        (user_id, period[0]) for user_id, period in pairs
                    ]),
                )
            )
            sheets = {(row.user_id, row.period_start): row for row in found.scalars().all()}
        locked = {
            period
            for user_id, period in pairs
            if sheet_is_locked(
                sheets.get((user_id, period[0])),
                period_closed=period[0] in closed_starts,
                period_end=period[1],
                policy=policy,
                now=now,
            )
        }
        return sorted(locked)
