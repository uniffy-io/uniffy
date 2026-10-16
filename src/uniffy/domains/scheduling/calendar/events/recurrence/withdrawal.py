"""Withdraw moved occurrences along with their original recurrence range."""

from dataclasses import dataclass
from datetime import UTC, date, datetime

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.lifecycle import stage_hard_delete
from uniffy.core.realtime.live import AfterCommit
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.rooms.events import EventBookingOperations

logger = logger.bind(component="scheduling.calendar.events.recurrence.withdrawal")


@dataclass(frozen=True, slots=True)
class WithdrawnOverride:
    event: CalendarEvent
    # Retires the description's buffer keys; runs only after the withdrawal commits.
    retire: AfterCommit


async def stage_following_overrides(
    session: AsyncSession,
    master: CalendarEvent,
    occurrence_date: date,
    buffer: UpdateBuffer,
) -> list[WithdrawnOverride]:
    """Withdraw moved occurrences from ``occurrence_date`` on, under the master's document lock."""
    overrides = list(
        (
            await session.scalars(
                select(CalendarEvent)
                .join(RecurrenceException, RecurrenceException.override_event_id == CalendarEvent.id)
                .where(
                    CalendarEvent.organization_id == master.organization_id,
                    CalendarEvent.recurrence_id == master.id,
                    CalendarEvent.is_deleted.is_(False),
                    RecurrenceException.event_id == master.id,
                    RecurrenceException.original_date >= occurrence_date,
                )
            )
        ).all()
    )
    if not overrides:
        return []
    withdrawn = [
        WithdrawnOverride(
            event,
            await stage_hard_delete(buffer, session, (ContentType.CALENDAR_EVENT, event.id)),
        )
        for event in overrides
    ]
    event_ids = [event.id for event in overrides]
    await session.execute(delete(EventReminder).where(EventReminder.event_id.in_(event_ids)))
    await EventBookingOperations(session).stage_cancel(master.organization_id, event_ids)
    for event in overrides:
        event.is_deleted = True
        event.deleted_at = datetime.now(UTC)
        event.updated_at = event.deleted_at
    return withdrawn


async def finish_following_overrides(
    search_indexer: SearchIndexer, withdrawn: list[WithdrawnOverride]
) -> None:
    for override in withdrawn:
        await override.retire()
        await publish_perm_change(ContentType.CALENDAR_EVENT, override.event.id, None, None)
        try:
            await search_indexer.remove(override.event.urn)
        except Exception:
            logger.opt(exception=True).warning("Withdrawn occurrence search removal failed")
