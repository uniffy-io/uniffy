"""Notifications the approval cycle sends after its commits."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.timesheet import Timesheet
from uniffy.core.types import NotificationType
from uniffy.domains.projects.time.access import TimeAccess


def period_label(sheet: Timesheet) -> str:
    return f"{sheet.period_start.isoformat()} to {sheet.period_end.isoformat()}"


def sheet_metadata(sheet: Timesheet, *, audience: str = "worker") -> dict[str, str]:
    """``audience`` tells the client which tab of My time to open: the worker's week or the inbox."""
    return {
        "timesheet_id": str(sheet.id),
        "user_id": str(sheet.user_id),
        "period_start": sheet.period_start.isoformat(),
        "audience": audience,
    }


async def display_name(session: AsyncSession, user_id: UUID) -> str:
    result = await session.execute(
        select(func.coalesce(User.full_name, User.email)).where(User.id == user_id)
    )
    return str(result.scalar_one_or_none() or "a member")


async def notify_submitted(session: AsyncSession, sheet: Timesheet, actor_id: UUID | None) -> None:
    """Reviewers hear about every submission; the worker only when someone else submitted."""
    name = await display_name(session, sheet.user_id)
    label = period_label(sheet)
    recipients = await TimeAccess(session).review_recipients(sheet.organization_id, sheet.user_id)
    if actor_id is not None:
        recipients.discard(actor_id)
    if recipients:
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TIMESHEET_SUBMITTED,
                organization_id=sheet.organization_id,
                actor_id=actor_id,
                title=f"Timesheet to review: {name}, {label}",
                body=sheet.submit_comment,
                target_user_ids=sorted(recipients),
                metadata=sheet_metadata(sheet, audience="reviewer"),
            )
        )
    if actor_id != sheet.user_id:
        who = "The period job" if actor_id is None else "A reviewer"
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TIMESHEET_SUBMITTED,
                organization_id=sheet.organization_id,
                actor_id=actor_id,
                title=f"{who} submitted your timesheet for {label}",
                body=sheet.submit_comment,
                target_user_ids=[sheet.user_id],
                metadata=sheet_metadata(sheet),
            )
        )


async def notify_reviewed(sheet: Timesheet, actor_id: UUID, *, approved: bool) -> None:
    label = period_label(sheet)
    await emit_notification(
        NotificationEvent(
            notification_type=(
                NotificationType.TIMESHEET_APPROVED
                if approved
                else NotificationType.TIMESHEET_REJECTED
            ),
            organization_id=sheet.organization_id,
            actor_id=actor_id,
            title=f"Timesheet approved: {label}" if approved else f"Timesheet rejected: {label}",
            body=sheet.review_comment,
            target_user_ids=[sheet.user_id],
            metadata=sheet_metadata(sheet),
        )
    )


async def notify_grace(sheet: Timesheet, actor_id: UUID, hours: int) -> None:
    await emit_notification(
        NotificationEvent(
            notification_type=NotificationType.TIMESHEET_REMINDER,
            organization_id=sheet.organization_id,
            actor_id=actor_id,
            title=f"Timesheet reopened for {hours}h: {period_label(sheet)}",
            body="Add or fix your entries before the window closes.",
            target_user_ids=[sheet.user_id],
            metadata=sheet_metadata(sheet),
        )
    )
