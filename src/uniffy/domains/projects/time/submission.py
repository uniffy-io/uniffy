"""Submitting a sheet for oneself stops a timer still running inside the period."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events.realtime import publish_content_changed, publish_notification
from uniffy.core.types import ContentType
from uniffy.domains.projects.time.periods import period_for
from uniffy.domains.projects.time.policy import load_time_policy
from uniffy.domains.projects.time.timers import TimerOperations, timer_changed_payload
from uniffy.domains.projects.time.timesheets import SheetView, TimesheetOperations


async def submit_timesheet(
    session: AsyncSession,
    actor_id: UUID,
    organization_id: UUID,
    user_id: UUID | None,
    day: date,
    *,
    comment: str,
    reviewer_id: UUID | None = None,
) -> SheetView:
    policy = await load_time_policy(session, organization_id)
    subject_id = user_id or actor_id
    stopped = None
    if subject_id == actor_id:
        today = datetime.now(UTC).date()
        start, end = period_for(day, policy)
        if start <= today <= end:
            stopped = await TimerOperations(session).stage_stop_active(
                actor_id, organization_id, policy, work_date=today
            )
    view = await TimesheetOperations(session).submit(
        actor_id,
        organization_id,
        user_id,
        day,
        comment=comment,
        policy=policy,
        reviewer_id=reviewer_id,
    )
    if stopped is not None:
        await publish_notification(actor_id, timer_changed_payload(organization_id))
        if stopped.worklog is not None:
            await publish_content_changed(ContentType.TASK, stopped.task_id, organization_id)
    return view
