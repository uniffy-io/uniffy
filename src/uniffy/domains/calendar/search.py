"""Refresh calendar search and mention projections."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import EventVisibility
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.calendar.operations import CalendarEventOperations


async def refresh_event_search_projection(
    session: AsyncSession,
    event: CalendarEvent,
    search_indexer: SearchIndexer,
) -> None:
    operations = CalendarEventOperations(session, search_indexer=search_indexer)
    metadata = await operations._index_for_search(event) or {}
    if event.visibility == EventVisibility.PRIVATE:
        return
    await publish_mention_state(
        organization_id=event.organization_id,
        urn=event.urn,
        changes={
            "title": event.title,
            "description": operations._get_search_description(event) or "",
            **metadata,
        },
    )
