"""Calendar operations."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import Select, and_, func, or_, select

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.types import (
    SortOrder,
)
from uniffy.domains.scheduling.calendar import queries

logger = logger.bind(component="scheduling.calendar.events.queries")

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class EventPage:
    events: list[CalendarEvent]
    next_page_token: str | None


class EventQueryOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type
        self.access_query = events.access_query

    async def _accessible_events(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID | None,
        category_id: UUID | None,
        start_date: datetime | None,
        end_date: datetime | None,
        include_deleted: bool,
        tag_ids: list[UUID] | None,
    ) -> Select:
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

        return query

    async def list_events_page(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID | None = None,
        category_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        page_token: str | None = None,
        page_size: int = DEFAULT_PAGE_SIZE,
        sort_order: str = "asc",
    ) -> EventPage:
        """A page of accessible events ordered by ``(start_time, id)``.

        Keyset paging, so the cost of a page does not grow with how far into
        the result set it sits, and no count of the whole set is taken.
        """
        page_size = max(1, min(page_size, MAX_PAGE_SIZE))
        descending = sort_order == SortOrder.DESCENDING

        query = await self._accessible_events(
            user_id,
            organization_id,
            calendar_id,
            category_id,
            start_date,
            end_date,
            include_deleted,
            tag_ids,
        )

        if page_token:
            cursor_start, cursor_id = decode_time_cursor(page_token)
            if descending:
                query = query.where(
                    or_(
                        CalendarEvent.start_time < cursor_start,
                        and_(
                            CalendarEvent.start_time == cursor_start,
                            CalendarEvent.id < cursor_id,
                        ),
                    )
                )
            else:
                query = query.where(
                    or_(
                        CalendarEvent.start_time > cursor_start,
                        and_(
                            CalendarEvent.start_time == cursor_start,
                            CalendarEvent.id > cursor_id,
                        ),
                    )
                )

        if descending:
            query = query.order_by(CalendarEvent.start_time.desc(), CalendarEvent.id.desc())
        else:
            query = query.order_by(CalendarEvent.start_time.asc(), CalendarEvent.id.asc())

        rows = list((await self.session.execute(query.limit(page_size + 1))).scalars().all())

        next_token: str | None = None
        if len(rows) > page_size:
            rows = rows[:page_size]
            tail = rows[-1]
            next_token = encode_time_cursor(tail.start_time, tail.id)

        return EventPage(events=rows, next_page_token=next_token)

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
        page_size: int = DEFAULT_PAGE_SIZE,
        sort_by: str = "start_time",
        sort_order: str = "asc",
    ) -> tuple[list[CalendarEvent], int]:
        """List events the user can access, numbering pages from one.

        Prefer :meth:`list_events_page`; this walks an offset and counts the
        whole result set, so both costs grow with the org's event count.
        """
        query = await self._accessible_events(
            user_id,
            organization_id,
            calendar_id,
            category_id,
            start_date,
            end_date,
            include_deleted,
            tag_ids,
        )

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
