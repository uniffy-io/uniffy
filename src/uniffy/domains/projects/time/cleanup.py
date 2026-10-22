"""Removal of tasks' time records inside the caller's transaction."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.timer import Timer
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.locks import SheetLocks


async def stage_delete_for_tasks(
    session: AsyncSession, organization_id: UUID, task_ids: list[UUID]
) -> None:
    """Hard-delete worklogs and timers of tasks about to be removed; refuses locked periods."""
    if not task_ids:
        return
    locked = await SheetLocks(session).locked_periods_for_tasks(organization_id, task_ids)
    if locked:
        start, end = locked[0]
        raise ValidationError(
            "task_ids",
            f"time entries sit in the locked period {start.isoformat()} to {end.isoformat()}; "
            "reopen it first",
        )
    await session.execute(delete(Timer).where(Timer.task_id.in_(task_ids)))
    await session.execute(delete(Worklog).where(Worklog.task_id.in_(task_ids)))
