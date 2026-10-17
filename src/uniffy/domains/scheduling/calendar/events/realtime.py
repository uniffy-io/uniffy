from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.events.realtime import publish_content_changed
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.realtime.metrics import REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
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
    query = (
        select(CalendarEvent)
        .execution_options(populate_existing=True)
        .where(
            CalendarEvent.id == event_id,
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.is_deleted.is_(False),
        )
    )
    if for_update:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


class EventRealtimePersistence:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.session = session
        self.search_indexer = search_indexer

    async def stage_save(
        self,
        organization_id: UUID,
        event_id: UUID,
        content: str,
        *,
        actor_id: UUID | None = None,
    ) -> tuple[CalendarEvent, Callable[[], Awaitable[None]]] | None:
        event = await load_live_event(self.session, event_id, organization_id, for_update=True)
        if event is None:
            return None
        if event.description and not content:
            REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL.labels(
                content_type=ContentType.CALENDAR_EVENT.value
            ).inc()
            logger.warning("Realtime render emptied event description", event_id=str(event_id))
        old_references = event.outgoing_references
        references = extract_all_outgoing_references(content, organization_id) or None
        if (event.description or "") == content and (old_references or []) == (references or []):

            async def refresh_projection() -> None:
                await self.after_projection(organization_id, event_id)

            return event, refresh_projection
        if (event.description or "") != content:
            self.session.add(
                EventActivity(
                    event_id=event.id,
                    actor_id=actor_id or event.organizer_id,
                    action="description_changed",
                    field_id="description",
                )
            )
        event.description = content
        event.outgoing_references = references
        event.updated_at = datetime.now(UTC)
        await self.session.flush()

        await stage_inline_reconciliation(
            self.session, ContentType.CALENDAR_EVENT, event_id, organization_id
        )
        with stage_notification_events(self.session):
            attendee_ids = set(
                (
                    await self.session.execute(
                        select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)
                    )
                ).scalars()
            )
            actor = actor_id or event.organizer_id
            await EventNotifications(
                EventContentOperations(self.session, self.search_indexer)
            ).emit_mention_notifications(
                event, actor, organization_id, old_references, {actor} | attendee_ids
            )

        async def after_commit() -> None:
            await self.after_projection(organization_id, event_id)

        return event, after_commit

    async def after_projection(self, organization_id: UUID, event_id: UUID) -> None:
        event = await load_live_event(self.session, event_id, organization_id)
        if event is None:
            return
        await EventContentOperations(self.session, self.search_indexer)._index_for_search(event)
        await publish_content_changed(ContentType.CALENDAR_EVENT, event.id, organization_id)
