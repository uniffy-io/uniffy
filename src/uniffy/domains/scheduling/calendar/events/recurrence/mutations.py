"""Calendar operations."""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import (
    NotFoundError,
    ValidationError,
)
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import (
    AttendeeStatus,
    EventStatus,
    RecurrencePattern,
)
from uniffy.domains.scheduling.calendar.recurrence import (
    count_occurrences_through,
    occurrence_start_for_date,
    resolve_event_zone,
    series_end_bound,
)

logger = logger.bind(component="scheduling.calendar.events.recurrence.mutations")


class RecurrenceMutationOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def cancel_occurrence(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
    ) -> None:
        """Cancel a single occurrence of a recurring event."""
        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, event)

        if event.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        exception = RecurrenceException(
            event_id=event_id,
            original_date=occurrence_date,
            is_cancelled=True,
        )
        self.session.add(exception)

        await self.events._reschedule_master_reminder_rows(event)

        await self.events._log_activity(
            event_id,
            user_id,
            "recurrence_changed",
            field_id="cancelled_occurrence",
            new_value=occurrence_date.isoformat(),
        )

        await self.session.commit()

    async def edit_single_occurrence(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
        **updates: object,
    ) -> CalendarEvent:
        """Materialize an override event for a single recurring occurrence."""
        master = await self.events._fetch_by_id(event_id, organization_id)
        if not master:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, master)

        if master.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        # Only the explicitly requested fields are diffed; the override's own
        # start/end come from the occurrence date, which is not a user edit.
        edited_before = {
            name: value
            for name, value in self.events._activity_snapshot(master).items()
            if name in updates
        }

        duration = master.end_time - master.start_time
        occ_start = occurrence_start_for_date(
            master.start_time, master.timezone or "UTC", occurrence_date
        )
        occ_end = occ_start + duration

        override = CalendarEvent(
            organization_id=master.organization_id,
            organizer_id=master.organizer_id,
            calendar_id=master.calendar_id,
            category_id=master.category_id,
            title=master.title,
            description=master.description,
            start_time=occ_start,
            end_time=occ_end,
            is_all_day=master.is_all_day,
            timezone=master.timezone,
            location=master.location,
            meeting_url=master.meeting_url,
            channel_id=master.channel_id,
            channel_auto_created=master.channel_auto_created,
            access_mode=master.access_mode,
            baseline_role=master.baseline_role,
            is_focus_time=master.is_focus_time,
            status=master.status,
            visibility=master.visibility,
            transparency=master.transparency,
            is_out_of_office=master.is_out_of_office,
            linked_resources=master.linked_resources,
            recurrence_pattern=RecurrencePattern.NONE,
            recurrence_id=master.id,
            reminders=master.reminders,
        )

        for field, value in updates.items():
            if value is not None and hasattr(override, field):
                setattr(override, field, value)

        self.session.add(override)
        await self.session.flush()

        exception = RecurrenceException(
            event_id=event_id,
            original_date=occurrence_date,
            is_cancelled=False,
            override_event_id=override.id,
        )
        self.session.add(exception)

        att_result = await self.session.execute(
            select(EventAttendee).where(EventAttendee.event_id == master.id)
        )
        active_attendee_ids: list[UUID] = []
        for att in att_result.scalars().all():
            new_att = EventAttendee(
                event_id=override.id,
                user_id=att.user_id,
                status=att.status,
                role=att.role,
                responded_at=att.responded_at,
                invited_via_group_id=att.invited_via_group_id,
            )
            self.session.add(new_att)
            if att.status != AttendeeStatus.DECLINED:
                active_attendee_ids.append(att.user_id)

        if override.reminders and active_attendee_ids:
            await self.events._create_reminder_rows(
                override,
                active_attendee_ids,
                override.reminders,
            )
        await self.events._reschedule_master_reminder_rows(master)

        await self.events._copy_tag_assignments(
            organization_id=organization_id,
            actor_id=user_id,
            source_event_id=master.id,
            target_event_id=override.id,
        )

        await self.events._log_activity(
            master.id,
            user_id,
            "recurrence_changed",
            field_id="occurrence_override",
            new_value=occurrence_date.isoformat(),
        )
        await self.events._log_activity(override.id, user_id, "created")
        await self.events._log_field_changes(override, user_id, edited_before)

        await self.events._index_for_search(override, skip_member_lookup=True)
        await self.session.commit()

        if master.status != EventStatus.CANCELLED and override.status == EventStatus.CANCELLED:
            await self.events._emit_cancellation_notification(
                override, user_id, organization_id, occurrence_date=occurrence_date
            )

        return override

    async def edit_this_and_following(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
        **updates: object,
    ) -> CalendarEvent:
        """Split a recurring series at `occurrence_date` and apply updates."""
        master = await self.events._fetch_by_id(event_id, organization_id)
        if not master:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, master)

        if master.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        edited_before = {
            name: value
            for name, value in self.events._activity_snapshot(master).items()
            if name in updates
        }

        event_zone = master.timezone or "UTC"
        original_config = dict(master.recurrence_config or {})

        # The new series inherits the original bounds: the original end date as
        # is, and a max-occurrence budget minus what the old series spends.
        new_config = dict(original_config)
        if new_config.get("max_occurrences"):
            consumed = count_occurrences_through(
                master.start_time.astimezone(resolve_event_zone(event_zone)).date(),
                master.recurrence_pattern,
                original_config,
                occurrence_date - timedelta(days=1),
            )
            remaining = int(new_config["max_occurrences"]) - consumed
            if remaining <= 0:
                raise ValidationError(
                    "occurrence_date", "This occurrence is beyond the end of the series."
                )
            new_config["max_occurrences"] = remaining

        # A rule change scoped to "this and following" defines the new series
        # outright, bounds included, instead of inheriting the original ones.
        new_pattern = master.recurrence_pattern
        requested_config = updates.pop("recurrence_config", None)
        if isinstance(requested_config, dict):
            new_config = dict(requested_config)
            if new_config.get("pattern"):
                new_pattern = RecurrencePattern(new_config["pattern"])

        config = dict(original_config)
        config["end_date"] = series_end_bound(occurrence_date, event_zone)
        master.recurrence_config = config
        master.updated_at = datetime.now(UTC)

        duration = master.end_time - master.start_time
        new_start = occurrence_start_for_date(master.start_time, event_zone, occurrence_date)
        new_end = new_start + duration

        new_event = CalendarEvent(
            organization_id=master.organization_id,
            organizer_id=master.organizer_id,
            calendar_id=master.calendar_id,
            category_id=master.category_id,
            title=master.title,
            description=master.description,
            start_time=new_start,
            end_time=new_end,
            is_all_day=master.is_all_day,
            timezone=master.timezone,
            location=master.location,
            meeting_url=master.meeting_url,
            channel_id=master.channel_id,
            channel_auto_created=master.channel_auto_created,
            access_mode=master.access_mode,
            baseline_role=master.baseline_role,
            is_focus_time=master.is_focus_time,
            status=master.status,
            visibility=master.visibility,
            transparency=master.transparency,
            is_out_of_office=master.is_out_of_office,
            linked_resources=master.linked_resources,
            recurrence_pattern=new_pattern,
            recurrence_config=new_config,
            reminders=master.reminders,
        )

        for field, value in updates.items():
            if value is not None and hasattr(new_event, field):
                setattr(new_event, field, value)

        self.session.add(new_event)
        await self.session.flush()

        att_result = await self.session.execute(
            select(EventAttendee).where(EventAttendee.event_id == master.id)
        )
        active_attendee_ids: list[UUID] = []
        for att in att_result.scalars().all():
            new_att = EventAttendee(
                event_id=new_event.id,
                user_id=att.user_id,
                status=att.status,
                role=att.role,
                responded_at=att.responded_at,
                invited_via_group_id=att.invited_via_group_id,
            )
            self.session.add(new_att)
            if att.status != AttendeeStatus.DECLINED:
                active_attendee_ids.append(att.user_id)

        if new_event.reminders and active_attendee_ids:
            await self.events._create_reminder_rows(
                new_event,
                active_attendee_ids,
                new_event.reminders,
            )
        await self.events._reschedule_master_reminder_rows(master)

        await self.events._copy_tag_assignments(
            organization_id=organization_id,
            actor_id=user_id,
            source_event_id=master.id,
            target_event_id=new_event.id,
        )

        await self.events._log_activity(
            master.id,
            user_id,
            "recurrence_changed",
            field_id="series_split",
            new_value=occurrence_date.isoformat(),
        )
        await self.events._log_activity(new_event.id, user_id, "created")
        await self.events._log_field_changes(new_event, user_id, edited_before)

        await self.events._index_for_search(new_event, skip_member_lookup=True)
        await self.session.commit()

        if master.status != EventStatus.CANCELLED and new_event.status == EventStatus.CANCELLED:
            await self.events._emit_cancellation_notification(
                new_event,
                user_id,
                organization_id,
            )

        return new_event
