"""Per-minute cron: emit TASK_DUE_SOON / TASK_OVERDUE, deduped via the notifications table."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.projects.task import Task
from uniffy.core.models.shared import NotificationType
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.db import open_session


async def _already_notified_today(
    session: AsyncSession,
    source_urn: str,
    notification_type: NotificationType,
) -> bool:
    """Check if a notification of this type was already sent today for this URN."""
    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await session.execute(
        select(func.count()).where(
            and_(
                Notification.source_urn == source_urn,
                Notification.notification_type == notification_type,
                Notification.created_at >= today_start,
            )
        )
    )
    return result.scalar_one() > 0


async def _process_due_tasks(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    today = now.strftime("%Y-%m-%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")

    stmt = (
        select(Task)
        .where(
            and_(
                Task.due_date.is_not(None),
                Task.status != "status_done",
                Task.is_deleted == False,  # noqa: E712
                Task.due_date <= tomorrow,
            )
        )
        .limit(500)
    )
    result = await session.execute(stmt)
    tasks = list(result.scalars().all())

    if not tasks:
        return 0

    count = 0
    for task in tasks:
        if not task.assignee_ids:
            continue

        task_urn = build_content_urn(ContentType.TASK, task.id)
        target_user_ids = [UUID(uid) for uid in task.assignee_ids]

        if task.due_date < today:
            if await _already_notified_today(session, task_urn, NotificationType.TASK_OVERDUE):
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.TASK_OVERDUE,
                    organization_id=task.organization_id,
                    actor_id=task.owner_id,
                    title=f"Overdue: {task.title}",
                    source_urn=task_urn,
                    target_user_ids=target_user_ids,
                )
            )
            count += 1

        elif task.due_date == today or task.due_date == tomorrow:
            if await _already_notified_today(session, task_urn, NotificationType.TASK_DUE_SOON):
                continue
            label = "Due today" if task.due_date == today else "Due tomorrow"
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.TASK_DUE_SOON,
                    organization_id=task.organization_id,
                    actor_id=task.owner_id,
                    title=f"{label}: {task.title}",
                    source_urn=task_urn,
                    target_user_ids=target_user_ids,
                )
            )
            count += 1

    return count


async def check_task_due_dates(ctx: dict[str, Any]) -> dict[str, Any]:
    """ARQ cron tick: scan tasks with due dates and emit at most one
    notification per task per day.
    """
    try:
        async with open_session() as session:
            count = await _process_due_tasks(session)
            if count > 0:
                logger.info(f"Sent {count} task due date reminder(s)")
            return {"status": "success", "count": count}
    except Exception:
        logger.error("Error checking task due dates", exc_info=True)
        return {"status": "error"}
