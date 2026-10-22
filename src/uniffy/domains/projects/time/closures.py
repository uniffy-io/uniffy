"""Period closures: a timekeeping admin shuts a whole period for everyone."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.timesheet import TimePeriod, TimePeriodStatus
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.locks import period_row
from uniffy.domains.projects.time.periods import period_for, periods_between
from uniffy.domains.projects.time.policy import load_time_policy


@dataclass(frozen=True)
class PeriodView:
    period: TimePeriod | None
    start_date: date
    end_date: date
    status: TimePeriodStatus


class PeriodOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)

    async def close(self, actor_id: UUID, organization_id: UUID, day: date) -> PeriodView:
        await self.access.require_timekeeping_admin(actor_id, organization_id)
        policy = await load_time_policy(self.session, organization_id)
        start, end = period_for(day, policy)
        now = datetime.now(UTC)
        if start > now.date():
            raise ValidationError("period_start", "a period can be closed once it has started")
        row = await period_row(self.session, organization_id, start)
        if row is not None and row.status == TimePeriodStatus.CLOSED:
            raise ValidationError("period", "this period is already closed")
        if row is None:
            row = TimePeriod(organization_id=organization_id, start_date=start, end_date=end)
            self.session.add(row)
        row.status = TimePeriodStatus.CLOSED
        row.closed_by_user_id = actor_id
        row.closed_at = now
        await self.session.flush()
        await self._audit(row, actor_id, Action.TIME_PERIOD_CLOSED)
        await self.session.commit()
        return PeriodView(period=row, start_date=start, end_date=end, status=row.status)

    async def reopen(self, actor_id: UUID, organization_id: UUID, day: date) -> PeriodView:
        await self.access.require_timekeeping_admin(actor_id, organization_id)
        policy = await load_time_policy(self.session, organization_id)
        start, end = period_for(day, policy)
        row = await period_row(self.session, organization_id, start)
        if row is None or row.status != TimePeriodStatus.CLOSED:
            raise ValidationError("period", "this period is not closed")
        row.status = TimePeriodStatus.OPEN
        row.closed_by_user_id = None
        row.closed_at = None
        await self.session.flush()
        await self._audit(row, actor_id, Action.TIME_PERIOD_REOPENED)
        await self.session.commit()
        return PeriodView(period=row, start_date=start, end_date=end, status=row.status)

    async def _audit(self, row: TimePeriod, actor_id: UUID, action: Action) -> None:
        await write_audit_event(
            self.session,
            organization_id=row.organization_id,
            actor_user_id=actor_id,
            action=action,
            resource_type=AuditResourceType.TIME_PERIOD,
            resource_id=row.id,
            details={
                "start_date": row.start_date.isoformat(),
                "end_date": row.end_date.isoformat(),
            },
        )

    async def list(
        self, actor_id: UUID, organization_id: UUID, *, from_date: date, to_date: date
    ) -> list[PeriodView]:
        """Every period touching the range from the policy, with the closed rows marked."""
        await self.access.require_active_actor(actor_id, organization_id)
        if to_date < from_date:
            raise ValidationError("to_date", "must not be before from_date")
        policy = await load_time_policy(self.session, organization_id)
        periods = periods_between(from_date, to_date, policy)
        result = await self.session.execute(
            select(TimePeriod).where(
                TimePeriod.organization_id == organization_id,
                TimePeriod.start_date.in_([start for start, _ in periods]),
            )
        )
        rows = {row.start_date: row for row in result.scalars().all()}
        return [
            PeriodView(
                period=rows.get(start),
                start_date=start,
                end_date=end,
                status=rows[start].status if start in rows else TimePeriodStatus.OPEN,
            )
            for start, end in periods
        ]
