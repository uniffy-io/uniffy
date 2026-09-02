"""Calendar operations."""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.types import (
    generate_id,
)
from uniffy.domains.scheduling.calendar.reminders import (
    is_recurring_master,
    load_exception_dates,
    next_reminder_start,
)

logger = logger.bind(component="scheduling.calendar.events.reminders")


class ReminderStagingOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def _create_reminder_rows(
        self,
        event: CalendarEvent,
        user_ids: list[UUID],
        intervals: list[int],
    ) -> None:
        """Write one pending row per (user, interval), anchored to the next
        occurrence that can still remind. Upserting resets a previously sent
        row instead of violating the (event, user, minutes) uniqueness.
        """
        now = datetime.now(UTC)
        exceptions: set[date] = set()
        if is_recurring_master(event):
            await self.session.flush()
            exceptions = await load_exception_dates(self.session, event.id)

        values: list[dict] = []
        for minutes in intervals:
            anchor = next_reminder_start(event, exceptions, minutes, now)
            if anchor is None:
                continue
            scheduled_at = anchor - timedelta(minutes=minutes)
            values.extend(
                {
                    "id": generate_id(),
                    "event_id": event.id,
                    "user_id": user_id,
                    "minutes_before": minutes,
                    "scheduled_at": scheduled_at,
                    "created_at": now,
                }
                for user_id in user_ids
            )
        if not values:
            return

        stmt = pg_insert(EventReminder).values(values)
        await self.session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_event_user_minutes",
                set_={"scheduled_at": stmt.excluded.scheduled_at, "sent_at": None},
            )
        )

    async def _reschedule_master_reminder_rows(self, event: CalendarEvent) -> None:
        """Re-anchor pending rows after a series edit changes which occurrence
        is next (cancelled or overridden occurrence, moved series end, new rule).
        """
        await self.session.flush()
        result = await self.session.execute(
            select(EventReminder).where(
                and_(
                    EventReminder.event_id == event.id,
                    EventReminder.sent_at.is_(None),
                )
            )
        )
        rows = list(result.scalars().all())
        if not rows:
            return

        exceptions: set[date] = set()
        if is_recurring_master(event):
            exceptions = await load_exception_dates(self.session, event.id)
        now = datetime.now(UTC)
        anchors: dict[int, datetime | None] = {}
        for row in rows:
            if row.minutes_before not in anchors:
                anchors[row.minutes_before] = next_reminder_start(
                    event, exceptions, row.minutes_before, now
                )
            anchor = anchors[row.minutes_before]
            if anchor is None:
                await self.session.delete(row)
            else:
                row.scheduled_at = anchor - timedelta(minutes=row.minutes_before)

    async def _delete_reminder_rows(
        self,
        event_id: UUID,
        user_ids: list[UUID] | None = None,
    ) -> None:
        stmt = delete(EventReminder).where(
            and_(
                EventReminder.event_id == event_id,
                EventReminder.sent_at.is_(None),
            )
        )
        if user_ids is not None:
            stmt = stmt.where(EventReminder.user_id.in_(user_ids))
        await self.session.execute(stmt)
