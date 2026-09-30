from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.realtime.metrics import REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.notifications import EventNotifications

logger = logger.bind(component="scheduling.calendar.events.realtime")


class EventRealtimePersistence:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def save(
        self, organization_id: UUID, event_id: UUID, content: str
    ) -> CalendarEvent | None:
        event = (
            await self.session.execute(
                select(CalendarEvent)
                .where(
                    CalendarEvent.id == event_id,
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.is_deleted.is_(False),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if event is None:
            return None
        if event.description and not content:
            REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL.labels(
                content_type=ContentType.CALENDAR_EVENT.value
            ).inc()
            logger.warning("Realtime render emptied event description", event_id=str(event_id))
        old_refs = event.outgoing_references
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
                    select(EventAttendee.user_id).where(
                        EventAttendee.event_id == (event.recurrence_id or event.id)
                    )
                )
            ).scalars()
        )
        excluded = {event.organizer_id} | attendee_ids
        newly_mentioned = (
            extract_mentioned_user_ids(event.outgoing_references)
            - extract_mentioned_user_ids(old_refs)
            - excluded
        )
        if newly_mentioned:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=event.organizer_id,
                    title=f"Mentioned you in: {event.title}",
                    source_urn=event.urn,
                    target_user_ids=list(newly_mentioned),
                )
            )
        old_teams = set(extract_mentioned_team_ids(old_refs))
        await EventNotifications(operations)._emit_team_mention_notifications(
            event,
            event.organizer_id,
            organization_id,
            [
                tid
                for tid in extract_mentioned_team_ids(event.outgoing_references)
                if tid not in old_teams
            ],
            excluded | newly_mentioned,
        )
        return event
