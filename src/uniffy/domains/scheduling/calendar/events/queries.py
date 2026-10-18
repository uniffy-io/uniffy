"""Calendar operations."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.orm import aliased

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.types import (
    RecurrencePattern,
    SortOrder,
)
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.recurrence import expand_recurrence, recurrence_end_date

logger = logger.bind(component="scheduling.calendar.events.queries")

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class EventPage:
    events: list[CalendarEvent]
    next_page_token: str | None


def _overlaps_window(
    event: CalendarEvent, start_date: datetime | None, end_date: datetime | None
) -> bool:
    if (end_date is None or event.start_time < end_date) and (
        start_date is None or event.end_time > start_date
    ):
        return True
    if event.recurrence_pattern == RecurrencePattern.NONE or start_date is None:
        return False
    duration = event.end_time - event.start_time
    lower = start_date - duration
    ends = recurrence_end_date(event.recurrence_config, event.timezone)
    if ends is not None and ends < lower.date() - timedelta(days=1):
        return False
    # Two cycles cover timezone boundaries and a filtered daily rule's weekdays.
    stride_days = {
        RecurrencePattern.DAILY: 14,
        RecurrencePattern.WEEKLY: 14,
        RecurrencePattern.BIWEEKLY: 28,
        RecurrencePattern.MONTHLY: 62,
        RecurrencePattern.YEARLY: 732,
    }[event.recurrence_pattern]
    interval = max(1, (event.recurrence_config or {}).get("interval", 1))
    remaining_days = (datetime.max.replace(tzinfo=start_date.tzinfo) - start_date).days
    horizon = start_date + timedelta(days=min(stride_days * interval, remaining_days))
    upper = min(end_date, horizon) if end_date is not None else horizon
    return any(
        occurrence.end_time > start_date
        for occurrence in expand_recurrence(
            event.start_time,
            event.end_time,
            event.recurrence_pattern,
            event.recurrence_config,
            lower,
            upper,
            timezone=event.timezone,
        )
    )


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
        visibility_filter: ColumnElement[bool] | None = None,
    ) -> Select:
        query = select(CalendarEvent).where(CalendarEvent.organization_id == organization_id)
        if visibility_filter is not None:
            query = query.where(visibility_filter)

        query = query.where(await self.events.event_access_filter(user_id, organization_id))

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
        visibility_filter: ColumnElement[bool] | None = None,
    ) -> EventPage:
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
            visibility_filter,
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
        visibility_filter: ColumnElement[bool] | None = None,
    ) -> tuple[list[CalendarEvent], int]:
        """Numbered pages serve bounded callers; growing lists use keyset pagination."""
        query = await self._accessible_events(
            user_id,
            organization_id,
            calendar_id,
            category_id,
            start_date,
            end_date,
            include_deleted,
            tag_ids,
            visibility_filter,
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

    async def list_events_in_window(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        calendar_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int,
    ) -> tuple[list[CalendarEvent], int]:
        """Count only qualifying masters so expired series cannot consume the export limit."""
        query = await self._accessible_events(
            user_id,
            organization_id,
            calendar_id,
            None,
            None,
            None,
            False,
            None,
        )

        query = query.where(CalendarEvent.recurrence_id.is_(None))
        override = aliased(CalendarEvent)
        moved = select(override.id).where(
            override.recurrence_id == CalendarEvent.id,
            override.organization_id == organization_id,
            override.is_deleted.is_(False),
        )
        if start_date is not None:
            moved = moved.where(override.end_time > start_date)
        if end_date is not None:
            moved = moved.where(override.start_time < end_date)
        has_override = moved.exists()
        overlap = [
            clause
            for clause in (
                CalendarEvent.start_time < end_date if end_date is not None else None,
                CalendarEvent.end_time > start_date if start_date is not None else None,
            )
            if clause is not None
        ]
        if overlap:
            series = [
                CalendarEvent.recurrence_pattern != RecurrencePattern.NONE,
                CalendarEvent.recurrence_id.is_(None),
            ]
            if end_date is not None:
                series.append(CalendarEvent.start_time < end_date)
            query = query.where(or_(and_(*overlap), and_(*series), has_override))

        rows = await self.session.stream(
            query
            .add_columns(has_override)
            .order_by(CalendarEvent.start_time.asc(), CalendarEvent.id.asc())
            .execution_options(yield_per=MAX_PAGE_SIZE)
        )
        events: list[CalendarEvent] = []
        try:
            async for event, moved_into_window in rows:
                if moved_into_window or _overlaps_window(event, start_date, end_date):
                    events.append(event)
                    if len(events) > limit:
                        break
        finally:
            await rows.close()
        return events[:limit], len(events)

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
