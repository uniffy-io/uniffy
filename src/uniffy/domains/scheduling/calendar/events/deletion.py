"""Calendar operations."""

from datetime import UTC, date, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
)
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    RecurrenceEditScope,
)
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.recurrence import (
    series_end_bound,
)
from uniffy.domains.scheduling.rooms.events import EventBookingOperations
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="scheduling.calendar.events.deletion")


class EventDeleteOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type
        self.search_indexer = events.search_indexer

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        permanent: bool = False,
        recurrence_edit_scope: RecurrenceEditScope | None = None,
        occurrence_date: date | None = None,
    ) -> bool:
        """Delete an event (soft by default, handles recurrences)."""
        if recurrence_edit_scope and occurrence_date:
            if recurrence_edit_scope == RecurrenceEditScope.THIS_EVENT:
                real_event_id = self.events._parse_master_event_id(event_id)
                await self.events.cancel_occurrence(
                    user_id,
                    organization_id,
                    real_event_id,
                    occurrence_date,
                )
                return True
            elif recurrence_edit_scope == RecurrenceEditScope.THIS_AND_FOLLOWING:
                real_event_id = self.events._parse_master_event_id(event_id)
                master = await self.events._fetch_by_id(real_event_id, organization_id)
                if not master:
                    raise NotFoundError("CalendarEvent", real_event_id)
                await self.events._require_delete(user_id, organization_id, master)
                config = dict(master.recurrence_config or {})
                config["end_date"] = series_end_bound(occurrence_date, master.timezone or "UTC")
                master.recurrence_config = config
                master.updated_at = datetime.now(UTC)
                await self.events._reschedule_master_reminder_rows(master)
                await self.session.commit()
                return True

        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_delete(user_id, organization_id, event)

        attendee_ids = await self.events._get_search_attendee_user_ids(event) or []

        await self.session.execute(delete(EventReminder).where(EventReminder.event_id == event_id))

        await EventBookingOperations(self.session).cancel(event_id)

        if permanent:
            tag_ops = TagOperations(self.session, self.events.search_indexer)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, event_id),
            )
            await queries.permanent_delete_event(self.session, event)
        else:
            await queries.soft_delete_event(self.session, event)

        await self.search_indexer.remove(build_content_urn(self.content_type, event_id))

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(
                Action.CALENDAR_EVENT_PERMANENTLY_DELETED
                if permanent
                else Action.CALENDAR_EVENT_DELETED
            ),
            resource_type=AuditResourceType.CALENDAR_EVENT,
            resource_id=event_id,
            details={
                "title": event.title,
                "start_time": event.start_time.isoformat(),
            },
        )
        await self.session.commit()

        await self.events._publish_attendee_access_change(
            event,
            [attendee_id for attendee_id in attendee_ids if attendee_id != user_id],
            ContentAccessAction.REVOKED,
        )

        return True
