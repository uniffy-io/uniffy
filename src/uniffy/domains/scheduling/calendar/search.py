"""Refresh calendar search and mention projections."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import EventVisibility
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations


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


class CalendarEventProjection:
    """An event's search document, for writers that are not the mutation façade.

    Import creates its rows in a transaction of its own and then owes search
    the same document ``create`` writes, which is a narrower need than the
    whole storage-backed operations class.
    """

    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self._operations = CalendarEventOperations(session, search_indexer=search_indexer)

    async def index(self, event: CalendarEvent) -> None:
        await self._operations._index_for_search(event, skip_member_lookup=True)
