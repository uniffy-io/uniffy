"""Period locks over worklog days; nothing locks while no timesheet or closed period exists."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class TimesheetOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def is_locked(self, organization_id: UUID, user_id: UUID, work_date: date) -> bool:
        return False

    async def locked_periods_for_tasks(
        self, organization_id: UUID, task_ids: list[UUID]
    ) -> list[tuple[date, date]]:
        return []
