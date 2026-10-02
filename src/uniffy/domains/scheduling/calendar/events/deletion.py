"""Calendar operations."""

from datetime import UTC, date, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
)
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.realtime.storage import lock_document
from uniffy.core.types import (
    ContentType,
    RecurrenceEditScope,
)
from uniffy.domains.scheduling.calendar.events.recurrence.withdrawal import (
    finish_following_overrides,
    stage_following_overrides,
)
from uniffy.domains.scheduling.calendar.mail.staging import stage_withdrawal_mail
from uniffy.domains.scheduling.calendar.queries import get_event_for_update
from uniffy.domains.scheduling.calendar.recurrence import (
    series_end_bound,
)
from uniffy.domains.scheduling.rooms.events import EventBookingOperations
from uniffy.domains.tags.context import ContentTagMutations

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
                master = await self._lock_event(real_event_id, organization_id)
                if not master:
                    raise NotFoundError("CalendarEvent", real_event_id)
                await self.events._require_delete(user_id, organization_id, master)
                await stage_withdrawal_mail(
                    self.session,
                    master,
                    actor_id=user_id,
                    occurrence_date=occurrence_date,
                    this_and_following=True,
                )
                config = dict(master.recurrence_config or {})
                config["end_date"] = series_end_bound(occurrence_date, master.timezone or "UTC")
                master.recurrence_config = config
                master.updated_at = datetime.now(UTC)
                await self.events._reschedule_master_reminder_rows(master)
                overrides = await stage_following_overrides(self.session, master, occurrence_date)
                await write_audit_event(
                    self.session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=Action.CALENDAR_EVENT_DELETED,
                    resource_type=AuditResourceType.CALENDAR_EVENT,
                    resource_id=master.id,
                    details={"occurrence_date": occurrence_date.isoformat(), "following": True},
                )
                await self.session.commit()
                await finish_following_overrides(self.search_indexer, overrides)
                return True

        event = await self._lock_event(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_delete(user_id, organization_id, event)

        attendee_ids = await self.events._get_search_attendee_user_ids(event) or []
        if event.recurrence_id is not None:
            master = await get_event_for_update(self.session, event.recurrence_id, organization_id)
            exception = await self.session.scalar(
                select(RecurrenceException).where(
                    RecurrenceException.event_id == event.recurrence_id,
                    RecurrenceException.override_event_id == event.id,
                )
            )
            if master is not None and exception is not None:
                exception.is_cancelled = True
                await stage_withdrawal_mail(
                    self.session, master, actor_id=user_id, occurrence_date=exception.original_date
                )
        else:
            await stage_withdrawal_mail(self.session, event, actor_id=user_id)
        overrides = list(
            (
                await self.session.scalars(
                    select(CalendarEvent).where(
                        CalendarEvent.organization_id == organization_id,
                        CalendarEvent.recurrence_id == event.id,
                    )
                )
            ).all()
        )
        affected = [event, *overrides]
        event_ids = [item.id for item in affected]
        await self.session.execute(
            delete(RealtimeYjsSnapshot).where(
                RealtimeYjsSnapshot.content_type == ContentType.CALENDAR_EVENT,
                RealtimeYjsSnapshot.content_id.in_(event_ids),
            )
        )
        await self.session.execute(
            delete(EventReminder).where(EventReminder.event_id.in_(event_ids))
        )
        await EventBookingOperations(self.session).stage_cancel(organization_id, event_ids)
        tag_ops = ContentTagMutations(self.session, self.events.search_indexer)
        tag_removals = []
        for item in affected:
            if permanent:
                tag_removals.append(
                    await tag_ops.stage_unassign_all_for_urn(
                        actor_id=user_id,
                        organization_id=organization_id,
                        content_urn=item.urn,
                    )
                )
            else:
                item.is_deleted = True
                item.deleted_at = datetime.now(UTC)
                item.updated_at = item.deleted_at
        if permanent:
            await self.session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(event_ids)))

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

        await publish_perm_change(ContentType.CALENDAR_EVENT, event.id, None, None)
        for staged in tag_removals:
            try:
                await tag_ops.finish_unassign_all_after_commit(staged)
            except Exception:
                logger.opt(exception=True).warning("Deleted event tag projection failed")
        for item in affected:
            try:
                await self.search_indexer.remove(item.urn)
            except Exception:
                logger.opt(exception=True).warning("Deleted event search removal failed")

        await self.events._publish_attendee_access_change(
            event,
            [attendee_id for attendee_id in attendee_ids if attendee_id != user_id],
            ContentAccessAction.REVOKED,
        )

        return True

    async def _lock_event(self, event_id: UUID, organization_id: UUID) -> CalendarEvent | None:
        master_id = await self.session.scalar(
            select(CalendarEvent.recurrence_id).where(
                CalendarEvent.id == event_id, CalendarEvent.organization_id == organization_id
            )
        )
        await lock_document(self.session, (ContentType.CALENDAR_EVENT, master_id or event_id))
        if master_id is not None:
            await get_event_for_update(self.session, master_id, organization_id)
        # Acquire the delete lock before outbox or revision writes can block attendee inserts.
        return await get_event_for_update(self.session, event_id, organization_id)
