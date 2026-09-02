"""Session-only calendar event queries."""

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.calendar.events.activity import EventActivityOperations
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations
from uniffy.domains.scheduling.calendar.events.queries import EventQueryOperations
from uniffy.domains.scheduling.calendar.events.recurrence.queries import RecurrenceQueryOperations
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content


class CalendarEventReader(EventContentOperations):
    def __init__(
        self,
        session: AsyncSession,
        *,
        _search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_calendar_content()
        super().__init__(session, _search_indexer)

    async def get_events_in_range(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_date: datetime,
        end_date: datetime,
        calendar_ids: list[UUID] | None = None,
        category_ids: list[UUID] | None = None,
        channel_id: UUID | None = None,
    ) -> list[CalendarEvent]:
        return await RecurrenceQueryOperations(self).get_events_in_range(
            user_id,
            organization_id,
            start_date,
            end_date,
            calendar_ids,
            category_ids,
            channel_id,
        )

    async def _expand_recurring_events(
        self,
        events: list[CalendarEvent],
        range_start: datetime,
        range_end: datetime,
    ) -> list[CalendarEvent]:
        return await RecurrenceQueryOperations(self)._expand_recurring_events(
            events,
            range_start,
            range_end,
        )

    @staticmethod
    def _parse_master_event_id(event_id: UUID | str) -> UUID:
        return RecurrenceQueryOperations._parse_master_event_id(event_id)

    async def list_events(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID | None = None,
        category_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "start_time",
        sort_order: str = "asc",
    ) -> tuple[list[CalendarEvent], int]:
        return await EventQueryOperations(self).list_events(
            user_id,
            organization_id,
            calendar_id,
            category_id,
            start_date,
            end_date,
            include_deleted,
            tag_ids,
            page,
            page_size,
            sort_by,
            sort_order,
        )

    async def get_event_with_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
    ) -> tuple[CalendarEvent, list[tuple[EventAttendee, dict]]]:
        return await EventQueryOperations(self).get_event_with_attendees(
            user_id,
            organization_id,
            event_id,
        )

    async def list_activities(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[EventActivity], int]:
        return await EventActivityOperations(self).list_activities(
            user_id,
            organization_id,
            event_id,
            limit,
            offset,
        )
