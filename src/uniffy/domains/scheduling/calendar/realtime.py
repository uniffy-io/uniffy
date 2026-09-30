from uuid import UUID

import pycrdt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import replace_external_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType, RecurrencePattern
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.realtime import EventRealtimePersistence
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden


class EventRealtimeAdapter:
    content_type = ContentType.CALENDAR_EVENT

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def _load(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> CalendarEvent | None:
        return (
            await session.execute(
                select(CalendarEvent).where(
                    CalendarEvent.id == content_id,
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()

    async def authorize(
        self, session: AsyncSession, user_id: UUID, organization_id: UUID, content_id: UUID
    ) -> ContentRole | None:
        event = await self._load(session, content_id, organization_id)
        if event is None:
            return None
        if event.recurrence_id is None and event.recurrence_pattern != RecurrencePattern.NONE:
            return None
        master = (
            await self._load(session, event.recurrence_id, organization_id)
            if event.recurrence_id is not None
            else event
        )
        if master is None:
            return None
        operations = EventContentOperations(session)
        role = await operations._resolve_role(user_id, organization_id, master)
        if role is None:
            return None
        is_attendee = await operations._is_attendee(user_id, organization_id, master.id)
        if event_details_hidden(master, user_id, role, is_attendee) or event_details_hidden(
            event, user_id, role, is_attendee
        ):
            return None
        return role

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        event = await self._load(session, content_id, organization_id)
        if event is not None and event.recurrence_id is not None:
            return ContentType.CALENDAR_EVENT, event.recurrence_id
        return None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        event = await self._load(session, content_id, organization_id)
        if event is not None:
            ydoc["markdown"] = pycrdt.Text(event.description or "")

    async def render_and_persist(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> bool:
        saved = await EventRealtimePersistence(session, self.search_indexer).save(
            organization_id, content_id, str(ydoc.get("markdown", type=pycrdt.Text))
        )
        return saved is not None

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        return replace_external_markdown(ydoc, content)


def register_event_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(EventRealtimeAdapter(search_indexer))
