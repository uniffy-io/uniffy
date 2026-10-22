"""The period job: auto-submit ended periods at their lock date and remind at the org's hour."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import NotificationType
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.events import notify_submitted
from uniffy.domains.projects.time.locks import period_is_closed
from uniffy.domains.projects.time.periods import (
    period_for,
    period_is_lock_due,
    previous_period,
)
from uniffy.domains.projects.time.policy import (
    PROJECTS_NAMESPACE,
    TIME_POLICY_KEY,
    ResolvedTimePolicy,
    load_time_policy,
)
from uniffy.domains.projects.time.timesheets import TimesheetOperations

logger = logger.bind(component="projects.time.reminders")

AUTO_SUBMIT_COMMENT = "Auto-submitted"
# Ended periods older than this are left alone so a long outage cannot submit months of history.
AUTO_SUBMIT_WINDOW = timedelta(days=14)
# Reminders go to people who logged time recently; members who never track are left alone.
REMINDER_ACTIVITY_WINDOW = timedelta(days=60)


@dataclass(frozen=True)
class PeriodJobSummary:
    organizations: int = 0
    submitted: int = 0
    worker_reminders: int = 0
    reviewer_reminders: int = 0


async def _organizations_with_policies(session: AsyncSession) -> list[UUID]:
    result = await session.execute(
        select(OrgSetting.organization_id).where(
            OrgSetting.namespace == PROJECTS_NAMESPACE, OrgSetting.key == TIME_POLICY_KEY
        )
    )
    return [row[0] for row in result.all()]


async def _members_with_entries(
    session: AsyncSession, organization_id: UUID, start: date, end: date
) -> set[UUID]:
    result = await session.execute(
        select(Worklog.user_id)
        .join(OrganizationMember, OrganizationMember.user_id == Worklog.user_id)
        .join(User, User.id == Worklog.user_id)
        .where(
            Worklog.organization_id == organization_id,
            Worklog.is_deleted.is_(False),
            Worklog.work_date >= start,
            Worklog.work_date <= end,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
        )
        .distinct()
    )
    return {row[0] for row in result.all()}


async def _sheets_for(
    session: AsyncSession, organization_id: UUID, start: date
) -> dict[UUID, Timesheet]:
    result = await session.execute(
        select(Timesheet).where(
            Timesheet.organization_id == organization_id, Timesheet.period_start == start
        )
    )
    return {sheet.user_id: sheet for sheet in result.scalars().all()}


async def _notified_today(
    session: AsyncSession, organization_id: UUID, user_id: UUID, now: datetime
) -> bool:
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await session.execute(
        select(func.count()).where(
            Notification.organization_id == organization_id,
            Notification.user_id == user_id,
            Notification.notification_type == NotificationType.TIMESHEET_REMINDER,
            Notification.created_at >= day_start,
        )
    )
    return int(result.scalar_one()) > 0


async def _auto_submit(
    session: AsyncSession, organization_id: UUID, policy: ResolvedTimePolicy, now: datetime
) -> int:
    """Submit every open sheet with entries in each ended period whose lock date has passed."""
    today = now.date()
    submitted: list[Timesheet] = []
    start, end = previous_period(period_for(today, policy)[0], policy)
    while end >= today - AUTO_SUBMIT_WINDOW:
        if period_is_lock_due(end, today, policy) and not await period_is_closed(
            session, organization_id, start
        ):
            sheets = await _sheets_for(session, organization_id, start)
            for user_id in sorted(await _members_with_entries(session, organization_id, start, end)):
                sheet = sheets.get(user_id)
                if sheet is not None and sheet.status != TimesheetStatus.OPEN:
                    continue
                submitted.append(
                    await TimesheetOperations(session).stage_submit(
                        None,
                        organization_id,
                        user_id,
                        start,
                        comment=AUTO_SUBMIT_COMMENT,
                        policy=policy,
                        now=now,
                    )
                )
        start, end = previous_period(start, policy)
    if not submitted:
        return 0
    await session.commit()
    for sheet in submitted:
        await notify_submitted(session, sheet, None)
    return len(submitted)


async def _remind(
    session: AsyncSession, organization_id: UUID, policy: ResolvedTimePolicy, now: datetime
) -> tuple[int, int]:
    """Workers with an ended period and no submitted sheet; reviewers with sheets waiting."""
    today = now.date()
    start, end = previous_period(period_for(today, policy)[0], policy)
    if await period_is_closed(session, organization_id, start):
        return 0, 0
    sheets = await _sheets_for(session, organization_id, start)
    active = await _members_with_entries(
        session, organization_id, start - REMINDER_ACTIVITY_WINDOW, end
    )
    label = f"{start.isoformat()} to {end.isoformat()}"
    workers = 0
    for user_id in sorted(active):
        sheet = sheets.get(user_id)
        if sheet is not None and sheet.status in (
            TimesheetStatus.SUBMITTED,
            TimesheetStatus.APPROVED,
        ):
            continue
        if await _notified_today(session, organization_id, user_id, now):
            continue
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TIMESHEET_REMINDER,
                organization_id=organization_id,
                actor_id=None,
                title=f"Submit your timesheet for {label}",
                body=(
                    "The period has ended; review your entries and submit them."
                    if sheet is None or sheet.status == TimesheetStatus.OPEN
                    else "Your timesheet was rejected; fix the entries and submit again."
                ),
                target_user_ids=[user_id],
                metadata={"period_start": start.isoformat(), "audience": "worker"},
            )
        )
        workers += 1

    access = TimeAccess(session)
    pending: dict[UUID, int] = {}
    for sheet in sheets.values():
        if sheet.status != TimesheetStatus.SUBMITTED:
            continue
        for reviewer_id in await access.review_recipients(organization_id, sheet.user_id):
            pending[reviewer_id] = pending.get(reviewer_id, 0) + 1
    reviewers = 0
    for reviewer_id, count in sorted(pending.items()):
        if await _notified_today(session, organization_id, reviewer_id, now):
            continue
        noun = "timesheet" if count == 1 else "timesheets"
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TIMESHEET_REMINDER,
                organization_id=organization_id,
                actor_id=None,
                title=f"{count} {noun} waiting for your review: {label}",
                target_user_ids=[reviewer_id],
                metadata={"period_start": start.isoformat(), "audience": "reviewer"},
            )
        )
        reviewers += 1
    return workers, reviewers


async def process_period_schedule(
    session: AsyncSession, now: datetime | None = None
) -> PeriodJobSummary:
    """One pass over every organization with a stored policy and approvals turned on."""
    now = now or datetime.now(UTC)
    summary = PeriodJobSummary()
    for organization_id in await _organizations_with_policies(session):
        policy = await load_time_policy(session, organization_id)
        if not (policy.enabled and policy.approvals_enabled):
            continue
        submitted = (
            await _auto_submit(session, organization_id, policy, now) if policy.auto_submit else 0
        )
        workers = reviewers = 0
        if policy.reminders_enabled and now.hour == policy.reminder_hour_utc:
            workers, reviewers = await _remind(session, organization_id, policy, now)
        summary = PeriodJobSummary(
            organizations=summary.organizations + 1,
            submitted=summary.submitted + submitted,
            worker_reminders=summary.worker_reminders + workers,
            reviewer_reminders=summary.reviewer_reminders + reviewers,
        )
    if summary.submitted or summary.worker_reminders or summary.reviewer_reminders:
        logger.info(
            f"Timesheet periods: {summary.submitted} auto-submitted, "
            f"{summary.worker_reminders} worker and {summary.reviewer_reminders} reviewer reminders"
        )
    return summary
