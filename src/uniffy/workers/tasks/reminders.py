"""Per-minute cron: emit CALENDAR_REMINDER notifications for due reminders."""

from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.shared import AttendeeStatus, NotificationType
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.db import open_session

logger = logger.bind(component="tasks.reminders")


def _format_reminder_interval(minutes: int) -> str:
    if minutes < 60:
        return f"in {minutes} minutes"
    if minutes == 60:
        return "in 1 hour"
    if minutes < 1440:
        hours = minutes // 60
        return f"in {hours} hours"
    if minutes == 1440:
        return "tomorrow"
    days = minutes // 1440
    return f"in {days} days"


async def _process_due_reminders(session: AsyncSession) -> int:
    now = datetime.now(UTC)

    stmt = (
        select(EventReminder, CalendarEvent)
        .join(CalendarEvent, EventReminder.event_id == CalendarEvent.id)
        .where(
            and_(
                EventReminder.sent_at.is_(None),
                EventReminder.scheduled_at <= now,
                CalendarEvent.is_deleted == False,  # noqa: E712
                CalendarEvent.start_time > now,
            )
        )
        .order_by(EventReminder.scheduled_at.asc())
        .limit(500)
    )
    result = await session.execute(stmt)
    rows = result.all()

    if not rows:
        return 0

    processed = 0
    for reminder, event in rows:
        attendee_stmt = select(EventAttendee).where(
            and_(
                EventAttendee.event_id == event.id,
                EventAttendee.user_id == reminder.user_id,
            )
        )
        attendee_result = await session.execute(attendee_stmt)
        attendee = attendee_result.scalar_one_or_none()

        if attendee and attendee.status == AttendeeStatus.DECLINED:
            reminder.sent_at = now
            processed += 1
            continue

        interval_text = _format_reminder_interval(reminder.minutes_before)
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CALENDAR_REMINDER,
                organization_id=event.organization_id,
                actor_id=event.organizer_id,
                title=f"{event.title} starts {interval_text}",
                source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                target_user_ids=[reminder.user_id],
            )
        )

        reminder.sent_at = now
        processed += 1

    await session.commit()
    return processed


async def check_calendar_reminders(ctx: dict[str, Any]) -> dict[str, Any]:
    """ARQ cron tick: emit notifications for due `EventReminder` rows and mark them sent."""
    try:
        async with open_session() as session:
            count = await _process_due_reminders(session)
            if count > 0:
                logger.info(f"Processed {count} calendar reminder(s)")
    except Exception:
        logger.exception("Error checking calendar reminders")
