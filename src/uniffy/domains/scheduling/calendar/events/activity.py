"""Calendar operations."""

import copy
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
)
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.domains.scheduling.calendar.events.state import _activity_value, event_details_hidden

logger = logger.bind(component="scheduling.calendar.events.activity")


# Fields whose edits are recorded in the event activity log, and the action each
# maps to. Fields carrying long or structured values are recorded without a
# before/after pair - the entry says what changed, the event row holds the value.
_ACTIVITY_TRACKED_FIELDS: tuple[tuple[str, str, bool], ...] = (
    ("title", "title_changed", True),
    ("start_time", "schedule_changed", True),
    ("end_time", "schedule_changed", True),
    ("is_all_day", "schedule_changed", True),
    ("timezone", "schedule_changed", True),
    ("location", "location_changed", True),
    ("meeting_url", "meeting_changed", True),
    ("channel_id", "meeting_changed", False),
    ("description", "description_changed", False),
    ("category_id", "category_changed", True),
    ("calendar_id", "calendar_changed", True),
    ("recurrence_config", "recurrence_changed", False),
    ("reminders", "reminders_changed", True),
    ("is_focus_time", "field_updated", True),
    ("status", "field_updated", True),
    ("visibility", "field_updated", True),
    ("transparency", "field_updated", True),
    ("is_out_of_office", "field_updated", True),
)


class EventActivityOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def list_activities(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[EventActivity], int]:
        """Read an event's activity log, newest first. Requires VIEW on the event."""
        master_id = self.events._parse_master_event_id(event_id)
        event = await self.events._fetch_by_id(master_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", master_id)

        role = await self.events._resolve_role(user_id, organization_id, event)
        if role is None:
            raise PermissionDeniedError("view", "calendar event")
        # The log carries before/after values of redacted fields, so a viewer
        # who only sees the busy block gets no history either.
        if event_details_hidden(
            event,
            user_id,
            role,
            await self.events._is_attendee(user_id, organization_id, master_id),
        ):
            raise PermissionDeniedError("view", "calendar event activity")

        total = await self.session.scalar(
            select(func.count())
            .select_from(EventActivity)
            .where(EventActivity.event_id == master_id)
        )

        result = await self.session.execute(
            select(EventActivity)
            .where(EventActivity.event_id == master_id)
            .order_by(EventActivity.timestamp.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(result.scalars().all()), int(total or 0)

    async def _log_activity(
        self,
        event_id: UUID,
        actor_id: UUID,
        action: str,
        field_id: str | None = None,
        previous_value: str | None = None,
        new_value: str | None = None,
    ) -> EventActivity:
        activity = EventActivity(
            event_id=self.events._parse_master_event_id(event_id),
            actor_id=actor_id,
            action=action,
            field_id=field_id,
            previous_value=previous_value,
            new_value=new_value,
        )
        self.session.add(activity)
        await self.session.flush()
        return activity

    async def _log_field_changes(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        before: dict[str, object],
    ) -> set[str]:
        """Emit one activity entry per tracked field that actually changed, and
        report the actions emitted so callers need not repeat the comparison.
        """
        emitted: set[str] = set()
        for field_name, action, keep_values in _ACTIVITY_TRACKED_FIELDS:
            if field_name not in before:
                continue
            old_value = before[field_name]
            new_value = getattr(event, field_name, None)
            if old_value == new_value:
                continue

            await self._log_activity(
                event.id,
                actor_id,
                action,
                field_id=field_name,
                previous_value=_activity_value(old_value) if keep_values else None,
                new_value=_activity_value(new_value) if keep_values else None,
            )
            emitted.add(action)
        return emitted

    @staticmethod
    def _activity_snapshot(event: CalendarEvent) -> dict[str, object]:
        return {
            field_name: copy.deepcopy(getattr(event, field_name, None))
            for field_name, _, _ in _ACTIVITY_TRACKED_FIELDS
        }
