from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.realtime.adapter import check_not_superseded
from uniffy.core.realtime.metrics import REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.notifications import EventNotifications

logger = logger.bind(component="scheduling.calendar.events.realtime")


async def load_live_event(
    session: AsyncSession,
    event_id: UUID,
    organization_id: UUID,
    *,
    for_update: bool = False,
) -> CalendarEvent | None:
    query = select(CalendarEvent).where(
        CalendarEvent.id == event_id,
        CalendarEvent.organization_id == organization_id,
        CalendarEvent.is_deleted.is_(False),
    )
    if for_update:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


class EventRealtimePersistence:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def save(
        self,
        organization_id: UUID,
        event_id: UUID,
        content: str,
        *,
        actor_id: UUID | None = None,
        supersede_after: datetime | None = None,
    ) -> CalendarEvent | None:
        event = await load_live_event(self.session, event_id, organization_id, for_update=True)
        if event is None:
            return None
        check_not_superseded(
            event.updated_at,
            supersede_after,
            stored=event.description,
            rendered=content,
            label=f"Event {event_id}",
        )
        if event.description and not content:
            REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL.labels(
                content_type=ContentType.CALENDAR_EVENT.value
            ).inc()
            logger.warning("Realtime render emptied event description", event_id=str(event_id))
        old_references = event.outgoing_references
        event.description = content
        event.outgoing_references = extract_all_outgoing_references(content, organization_id) or None
        event.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(event)
        operations = EventContentOperations(self.session, self.search_indexer)
        await operations._index_for_search(event)
        attendee_ids = set(
            (
                await self.session.execute(
                    select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)
                )
            ).scalars()
        )
        # The last live editor stands in for the missing request actor, else the organizer.
        actor = actor_id or event.organizer_id
        await EventNotifications(operations).emit_mention_notifications(
            event, actor, organization_id, old_references, {actor} | attendee_ids
        )
        return event
