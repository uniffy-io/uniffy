"""Per-minute cron: emit CALENDAR_REMINDER notifications for due reminders."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.shared import AttendeeStatus, NotificationType, RecurrencePattern
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.calendar.reminders import is_recurring_master, next_reminder_start
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="calendar.jobs.jobs")


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


async def _load_exceptions(session: AsyncSession, event_ids: list[UUID]) -> dict[UUID, set]:
    if not event_ids:
        return {}
    result = await session.execute(
        select(RecurrenceException.event_id, RecurrenceException.original_date).where(
            RecurrenceException.event_id.in_(event_ids)
        )
    )
    by_event: dict[UUID, set] = {}
    for event_id, original_date in result.all():
        by_event.setdefault(event_id, set()).add(original_date)
    return by_event


async def _process_due_reminders(session: AsyncSession) -> int:
    now = datetime.now(UTC)

    # Recurring masters stay eligible past their first start: their pending
    # rows roll forward to later occurrences instead of being marked sent.
    recurring_master = and_(
        CalendarEvent.recurrence_pattern != RecurrencePattern.NONE,
        CalendarEvent.recurrence_id.is_(None),
    )
    stmt = (
        select(EventReminder, CalendarEvent)
        .join(CalendarEvent, EventReminder.event_id == CalendarEvent.id)
        .where(
            and_(
                EventReminder.sent_at.is_(None),
                EventReminder.scheduled_at <= now,
                CalendarEvent.is_deleted == False,  # noqa: E712
                or_(CalendarEvent.start_time > now, recurring_master),
            )
        )
        .order_by(EventReminder.scheduled_at.asc())
        .limit(500)
    )
    result = await session.execute(stmt)
    rows = result.all()

    if not rows:
        return 0

    recurring_ids = [event.id for _, event in rows if is_recurring_master(event)]
    exceptions_by_event = await _load_exceptions(session, recurring_ids)

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

        recurring = is_recurring_master(event)
        target_start = reminder.scheduled_at + timedelta(minutes=reminder.minutes_before)
        # A recurring row whose target already started is stale (worker
        # downtime, or an upgrade re-opened old rows): re-anchor silently
        # rather than reminding about an occurrence that is over.
        emit = not recurring or target_start > now

        if emit:
            interval_text = _format_reminder_interval(reminder.minutes_before)
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_REMINDER,
                    organization_id=event.organization_id,
                    # A reminder is fired by the clock, not by a person. Naming the
                    # organizer here made the fan-out drop them as the actor, so the
                    # organizer never received a reminder for their own event.
                    actor_id=None,
                    title=f"{event.title} starts {interval_text}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=[reminder.user_id],
                    metadata=({"channel_id": str(event.channel_id)} if event.channel_id else None),
                )
            )

        if recurring:
            next_start = next_reminder_start(
                event,
                exceptions_by_event.get(event.id, set()),
                reminder.minutes_before,
                now,
                after_start=target_start if emit else None,
            )
            if next_start is None:
                reminder.sent_at = now
            else:
                reminder.scheduled_at = next_start - timedelta(minutes=reminder.minutes_before)
        else:
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
