"""Refresh calendar search and mention projections."""

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.search.policy import SearchContainerAccess
from uniffy.core.types import ContentType, EventVisibility
from uniffy.domains.scheduling.calendar.calendars.search import calendar_search_access
from uniffy.domains.scheduling.calendar.operations import CalendarEventReader


async def refresh_event_search_projection(
    session: AsyncSession,
    event: CalendarEvent,
    search_indexer: SearchIndexer,
) -> None:
    operations = CalendarEventReader(session, _search_indexer=search_indexer)
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
        self._operations = CalendarEventReader(session, _search_indexer=search_indexer)

    async def index(self, event: CalendarEvent) -> None:
        await self._operations._index_for_search(event, skip_member_lookup=True)


# Documents per search write: big enough to keep a 10,000-event feed to a few dozen calls.
_FEED_INDEX_BATCH = 500


class FeedEventProjection:
    """Search documents for feed events, which carry no tags, attendees or member grants."""

    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self._session = session
        self._search_indexer = search_indexer
        self._reader = CalendarEventReader(session, _search_indexer=search_indexer)
        self._audiences: dict[UUID, SearchContainerAccess] = {}

    async def index_events(self, event_ids: Sequence[UUID]) -> None:
        for start in range(0, len(event_ids), _FEED_INDEX_BATCH):
            chunk = list(event_ids[start : start + _FEED_INDEX_BATCH])
            events = (
                await self._session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.id.in_(chunk),
                        CalendarEvent.is_deleted.is_(False),
                    )
                )
            ).scalars()
            await self._search_indexer.batch_index([await self._document(e) for e in events])

    async def index_calendar(self, calendar_id: UUID) -> None:
        event_ids = list(
            (
                await self._session.execute(
                    select(CalendarEvent.id).where(
                        CalendarEvent.calendar_id == calendar_id,
                        CalendarEvent.is_deleted.is_(False),
                    )
                )
            ).scalars()
        )
        await self.index_events(event_ids)

    async def publish_changed(self, event_ids: Sequence[UUID]) -> None:
        """Push new details to open mentions of events that already existed."""
        for start in range(0, len(event_ids), _FEED_INDEX_BATCH):
            events = (
                await self._session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.id.in_(event_ids[start : start + _FEED_INDEX_BATCH]),
                        CalendarEvent.visibility != EventVisibility.PRIVATE,
                    )
                )
            ).scalars()
            for event in events:
                await publish_mention_state(
                    organization_id=event.organization_id,
                    urn=event.urn,
                    changes={
                        "title": event.title,
                        "description": self._reader._get_search_description(event) or "",
                        **(self._reader._get_search_metadata(event) or {}),
                    },
                )

    async def _document(self, event: CalendarEvent) -> dict[str, Any]:
        reader = self._reader
        mode, baseline = await reader._effective_policy(event.organization_id, event)
        # A feed writes a series and its moved occurrences onto one calendar, so the
        # calendar row itself names the audience; no per-occurrence master lookup.
        audience = self._audiences.get(event.calendar_id)
        if audience is None:
            audience = await calendar_search_access(
                self._session, event.organization_id, event.calendar_id
            )
            self._audiences[event.calendar_id] = audience
        return {
            "urn": build_content_urn(ContentType.CALENDAR_EVENT, event.id),
            "organization_id": event.organization_id,
            "title": reader._get_search_title(event),
            "entity_type": ContentType.CALENDAR_EVENT.value,
            "url_path": reader._get_url_path(event),
            "owner_id": event.owner_id,
            "access_mode": mode.value,
            "baseline_role": baseline.value if baseline is not None else None,
            "keywords": reader._build_search_keywords(event),
            "description": reader._get_search_description(event),
            "container": audience,
            "metadata": reader._get_search_metadata(event),
        }
