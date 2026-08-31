"""Calendar operations."""

from datetime import datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import (
    SortOrder,
)
from uniffy.domains.scheduling.calendar import queries

logger = logger.bind(component="scheduling.calendar.events.queries")


class EventQueryOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type
        self.access_query = events.access_query

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
        """List events the user can access with filters/pagination."""
        query = select(CalendarEvent).where(CalendarEvent.organization_id == organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=CalendarEvent.id,
            owner_id_column=CalendarEvent.organizer_id,
            access_mode_column=CalendarEvent.access_mode,
            baseline_role_column=CalendarEvent.baseline_role,
        )

        query = query.where(
            or_(
                access_filter,
                await self.events.attendee_access_filter(user_id, organization_id),
            )
        )

        if calendar_id:
            query = query.where(CalendarEvent.calendar_id == calendar_id)
        if category_id:
            query = query.where(CalendarEvent.category_id == category_id)
        if start_date:
            query = query.where(CalendarEvent.start_time >= start_date)
        if end_date:
            query = query.where(CalendarEvent.end_time <= end_date)
        if not include_deleted:
            query = query.where(CalendarEvent.is_deleted == False)  # noqa: E712
        if tag_ids:
            query = query.where(CalendarEvent.id.in_(self.events._tag_filter_subquery(tag_ids)))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        sort_col = getattr(CalendarEvent, sort_by, CalendarEvent.start_time)
        if sort_order == SortOrder.DESCENDING:
            query = query.order_by(sort_col.desc())
        else:
            query = query.order_by(sort_col.asc())

        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        events = list(result.scalars().all())

        return events, total

    async def get_event_with_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
    ) -> tuple[CalendarEvent, list[tuple[EventAttendee, dict]]]:
        """Get an event and its attendees (view-access required)."""
        event = await self.events.get_by_id(user_id, organization_id, event_id)
        attendees = await queries.get_event_attendees(self.session, event_id)
        return event, attendees
