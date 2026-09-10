"""Calendar operations."""

import copy
from datetime import date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import (
    RecurrencePattern,
)
from uniffy.domains.scheduling.calendar.recurrence import (
    OCCURRENCE_ID_SEPARATOR,
    expand_recurrence,
)

logger = logger.bind(component="scheduling.calendar.events.recurrence.queries")

# A year of calendar covers every view a client offers; past that the caller is
# asking for a bulk export, which is the interop surface rather than this one.
MAX_RANGE_DAYS = 366


class RecurrenceQueryOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type
        self.access_query = events.access_query

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
        """Get events the user can access in a date range.

        Combines the canonical accessible-filter with an attendee bypass
        so invitees always see events they are on.
        """
        if end_date < start_date:
            raise ValidationError("range", "Range end precedes its start")
        if end_date - start_date > timedelta(days=MAX_RANGE_DAYS):
            raise ValidationError("range", f"Range is capped at {MAX_RANGE_DAYS} days")

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=CalendarEvent.id,
            owner_id_column=CalendarEvent.organizer_id,
            access_mode_column=CalendarEvent.access_mode,
            baseline_role_column=CalendarEvent.baseline_role,
        )
        permission_filter = or_(
            access_filter,
            await self.events.attendee_access_filter(user_id, organization_id),
        )

        base_filters = [
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.is_deleted == False,  # noqa: E712
            permission_filter,
        ]
        if calendar_ids:
            base_filters.append(CalendarEvent.calendar_id.in_(calendar_ids))
        if category_ids:
            base_filters.append(CalendarEvent.category_id.in_(category_ids))
        if channel_id:
            base_filters.append(CalendarEvent.channel_id == channel_id)

        query = (
            select(CalendarEvent)
            .where(
                and_(
                    *base_filters,
                    CalendarEvent.start_time < end_date,
                    CalendarEvent.end_time > start_date,
                )
            )
            .order_by(CalendarEvent.start_time.asc())
        )
        result = await self.session.execute(query)
        db_events = list(result.scalars().all())
        seen_ids = {e.id for e in db_events}

        recurring_query = select(CalendarEvent).where(
            and_(
                *base_filters,
                CalendarEvent.recurrence_pattern != RecurrencePattern.NONE,
                CalendarEvent.recurrence_id.is_(None),
                CalendarEvent.start_time < end_date,
            )
        )
        recurring_result = await self.session.execute(recurring_query)
        for event in recurring_result.scalars().all():
            if event.id not in seen_ids:
                db_events.append(event)
                seen_ids.add(event.id)

        return await self._expand_recurring_events(db_events, start_date, end_date)

    @staticmethod
    def _parse_master_event_id(event_id: UUID | str) -> UUID:
        """Extract the real master UUID from a possibly synthetic occurrence id."""
        event_id_str = str(event_id)
        if OCCURRENCE_ID_SEPARATOR in event_id_str:
            return UUID(event_id_str.split(OCCURRENCE_ID_SEPARATOR)[0])
        return UUID(event_id_str) if isinstance(event_id, str) else event_id

    @staticmethod
    def _collect_update_kwargs(**fields: object) -> dict:
        return {k: v for k, v in fields.items() if v is not None}

    async def _expand_recurring_events(
        self,
        events: list[CalendarEvent],
        range_start: datetime,
        range_end: datetime,
    ) -> list[CalendarEvent]:
        """Expand recurring masters into virtual occurrences."""
        recurring_ids = [
            e.id
            for e in events
            if e.recurrence_pattern != RecurrencePattern.NONE and e.recurrence_id is None
        ]

        exceptions_by_event: dict[UUID, dict[date, RecurrenceException]] = {}
        if recurring_ids:
            # Only exceptions the expansion can actually skip are worth loading,
            # and it widens its date window by a day each side of the range.
            exc_result = await self.session.execute(
                select(RecurrenceException).where(
                    and_(
                        RecurrenceException.event_id.in_(recurring_ids),
                        RecurrenceException.original_date >= range_start.date() - timedelta(days=1),
                        RecurrenceException.original_date <= range_end.date() + timedelta(days=1),
                    )
                )
            )
            for exc in exc_result.scalars().all():
                exceptions_by_event.setdefault(exc.event_id, {})[exc.original_date] = exc

            override_result = await self.session.execute(
                select(CalendarEvent).where(
                    and_(
                        CalendarEvent.recurrence_id.in_(recurring_ids),
                        CalendarEvent.is_deleted == False,  # noqa: E712
                        CalendarEvent.start_time < range_end,
                        CalendarEvent.end_time > range_start,
                    )
                )
            )
            override_events = list(override_result.scalars().all())
        else:
            override_events = []

        result: list[CalendarEvent] = []

        for event in events:
            is_recurring_master = (
                event.recurrence_pattern != RecurrencePattern.NONE and event.recurrence_id is None
            )

            if not is_recurring_master:
                result.append(event)
                continue

            master_start = event.start_time
            master_end = event.end_time
            if master_start < range_end and master_end > range_start:
                result.append(event)

            event_exceptions = exceptions_by_event.get(event.id, {})
            exception_dates = set(event_exceptions.keys())

            occurrences = expand_recurrence(
                start_time=event.start_time,
                end_time=event.end_time,
                recurrence_pattern=event.recurrence_pattern,
                recurrence_config=event.recurrence_config,
                range_start=range_start,
                range_end=range_end,
                exception_dates=exception_dates,
                timezone=event.timezone or "UTC",
            )

            for occ in occurrences:
                virtual = copy.copy(event)
                virtual.start_time = occ.start_time
                virtual.end_time = occ.end_time
                synthetic_id = (
                    f"{event.id}{OCCURRENCE_ID_SEPARATOR}{occ.occurrence_date.isoformat()}"
                )
                virtual.id = synthetic_id  # type: ignore[assignment]
                virtual._occurrence_date = occ.occurrence_date.isoformat()  # type: ignore[attr-defined]
                result.append(virtual)

        # An override is an ordinary row that overlaps the range, so the caller's
        # own query has usually returned it already; re-adding it blindly gives
        # the client two entries under one id.
        seen_ids = {e.id for e in result}
        result.extend(e for e in override_events if e.id not in seen_ids)
        result.sort(key=lambda e: e.start_time)
        return result
