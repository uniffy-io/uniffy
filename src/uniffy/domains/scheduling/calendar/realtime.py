from datetime import datetime
from uuid import UUID

import pycrdt
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.markdown import markdown_text, replace_external_markdown, seed_markdown
from uniffy.core.realtime.state import DocKey
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole, ContentType, RecurrencePattern
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.realtime import (
    EventRealtimePersistence,
    load_live_event,
)
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden


class EventRealtimeAdapter:
    content_type = ContentType.CALENDAR_EVENT

    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    async def authorize(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        content_id: UUID,
        *,
        checker: PermissionChecker | None = None,
    ) -> ContentRole | None:
        event = await load_live_event(session, content_id, organization_id)
        if event is None:
            return None
        if event.recurrence_id is None and event.recurrence_pattern != RecurrencePattern.NONE:
            return None
        # Grants, blocks and attendee rows live on the row itself, the same as ordinary reads.
        operations = EventContentOperations(session, permission_checker=checker)
        role = await operations._resolve_role(user_id, organization_id, event)
        if role is None:
            return None
        is_attendee = await operations._is_attendee(user_id, organization_id, event.id)
        if event_details_hidden(event, user_id, role, is_attendee):
            return None
        if event.recurrence_id is not None:
            # Master visibility is not copied onto override rows; keep it as a privacy floor.
            master = await load_live_event(session, event.recurrence_id, organization_id)
            if master is None or event_details_hidden(master, user_id, role, is_attendee):
                return None
        return role

    async def policy_key(
        self, session: AsyncSession, content_id: UUID, organization_id: UUID
    ) -> DocKey | None:
        event = await load_live_event(session, content_id, organization_id)
        if event is not None and event.recurrence_id is not None:
            return ContentType.CALENDAR_EVENT, event.recurrence_id
        return None

    async def hydrate_ydoc(
        self, session: AsyncSession, ydoc: pycrdt.Doc, content_id: UUID, organization_id: UUID
    ) -> None:
        event = await load_live_event(session, content_id, organization_id)
        if event is not None:
            seed_markdown(ydoc, event.description or "")

    async def render_and_persist(
        self,
        session: AsyncSession,
        ydoc: pycrdt.Doc,
        content_id: UUID,
        organization_id: UUID,
        *,
        actor_id: UUID | None = None,
        supersede_after: datetime | None = None,
    ) -> bool:
        saved = await EventRealtimePersistence(session, self.search_indexer).save(
            organization_id,
            content_id,
            str(markdown_text(ydoc)),
            actor_id=actor_id,
            supersede_after=supersede_after,
        )
        return saved is not None

    def apply_external_content(self, ydoc: pycrdt.Doc, content: str) -> bool:
        return replace_external_markdown(ydoc, content)


def register_event_realtime_adapter(search_indexer: SearchIndexer) -> None:
    register_realtime_adapter(EventRealtimeAdapter(search_indexer))
