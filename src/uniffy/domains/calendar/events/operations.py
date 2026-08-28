"""Calendar event operations façade."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import (
    AttendeeRole,
    AttendeeStatus,
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrenceEditScope,
    RecurrencePattern,
)
from uniffy.domains.calendar.events.activity import EventActivityOperations
from uniffy.domains.calendar.events.attendees import AttendeeOperations
from uniffy.domains.calendar.events.channels import ChannelBindingOperations
from uniffy.domains.calendar.events.content import EventContentOperations
from uniffy.domains.calendar.events.creation import EventCreateOperations
from uniffy.domains.calendar.events.deletion import EventDeleteOperations
from uniffy.domains.calendar.events.notifications import EventNotifications
from uniffy.domains.calendar.events.queries import EventQueryOperations
from uniffy.domains.calendar.events.recurrence.mutations import RecurrenceMutationOperations
from uniffy.domains.calendar.events.recurrence.queries import RecurrenceQueryOperations
from uniffy.domains.calendar.events.registration import register_calendar_content
from uniffy.domains.calendar.events.reminders import ReminderStagingOperations
from uniffy.domains.calendar.events.state import _StagedCalendarEventCreate
from uniffy.domains.calendar.events.tags import EventTagOperations
from uniffy.domains.calendar.events.updates import EventUpdateOperations


class CalendarEventOperations(EventContentOperations):
    """Stable event API composed from focused calendar workflows."""

    def __init__(self, session: AsyncSession) -> None:
        register_calendar_content()
        super().__init__(session)

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        start_time: datetime,
        end_time: datetime,
        calendar_id: UUID,
        description: str = "",
        is_all_day: bool = False,
        timezone: str = "UTC",
        location: str = "",
        meeting_url: str | None = None,
        category_id: UUID | None = None,
        attendee_ids: list[UUID] | None = None,
        attendee_roles: dict[UUID, AttendeeRole] | None = None,
        recurrence_pattern: RecurrencePattern = RecurrencePattern.NONE,
        recurrence_config: dict | None = None,
        is_focus_time: bool = False,
        tag_ids: list[UUID] | None = None,
        linked_resources: list[dict] | None = None,
        reminders: list[int] | None = None,
        room_id: UUID | None = None,
        channel_id: UUID | None = None,
        channel_auto_created: bool = False,
        status: EventStatus = EventStatus.CONFIRMED,
        visibility: EventVisibility = EventVisibility.STANDARD,
        transparency: EventTransparency | None = None,
        is_out_of_office: bool = False,
    ) -> CalendarEvent:
        return await EventCreateOperations(self).create(
            user_id=user_id,
            organization_id=organization_id,
            title=title,
            start_time=start_time,
            end_time=end_time,
            calendar_id=calendar_id,
            description=description,
            is_all_day=is_all_day,
            timezone=timezone,
            location=location,
            meeting_url=meeting_url,
            category_id=category_id,
            attendee_ids=attendee_ids,
            attendee_roles=attendee_roles,
            recurrence_pattern=recurrence_pattern,
            recurrence_config=recurrence_config,
            is_focus_time=is_focus_time,
            tag_ids=tag_ids,
            linked_resources=linked_resources,
            reminders=reminders,
            room_id=room_id,
            channel_id=channel_id,
            channel_auto_created=channel_auto_created,
            status=status,
            visibility=visibility,
            transparency=transparency,
            is_out_of_office=is_out_of_office,
        )

    async def _finish_calendar_event_create_after_commit(
        self,
        staged: _StagedCalendarEventCreate,
    ) -> None:
        await EventCreateOperations(self)._finish_calendar_event_create_after_commit(staged)

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        title: str | None = None,
        description: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        is_all_day: bool | None = None,
        timezone: str | None = None,
        location: str | None = None,
        meeting_url: str | None = None,
        calendar_id: UUID | None = None,
        category_id: UUID | None = None,
        recurrence_config: dict | None = None,
        is_focus_time: bool | None = None,
        tag_ids: list[UUID] | None = None,
        linked_resources: list[dict] | None = None,
        attendee_ids: list[UUID] | None = None,
        reminders: list[int] | None = None,
        recurrence_edit_scope: RecurrenceEditScope | None = None,
        occurrence_date: date | None = None,
        room_id: str | None = None,
        channel_id: str | None = None,
        channel_auto_created: bool | None = None,
        status: EventStatus | None = None,
        visibility: EventVisibility | None = None,
        transparency: EventTransparency | None = None,
        is_out_of_office: bool | None = None,
    ) -> CalendarEvent:
        return await EventUpdateOperations(self).update(
            user_id=user_id,
            organization_id=organization_id,
            event_id=event_id,
            title=title,
            description=description,
            start_time=start_time,
            end_time=end_time,
            is_all_day=is_all_day,
            timezone=timezone,
            location=location,
            meeting_url=meeting_url,
            calendar_id=calendar_id,
            category_id=category_id,
            recurrence_config=recurrence_config,
            is_focus_time=is_focus_time,
            tag_ids=tag_ids,
            linked_resources=linked_resources,
            attendee_ids=attendee_ids,
            reminders=reminders,
            recurrence_edit_scope=recurrence_edit_scope,
            occurrence_date=occurrence_date,
            room_id=room_id,
            channel_id=channel_id,
            channel_auto_created=channel_auto_created,
            status=status,
            visibility=visibility,
            transparency=transparency,
            is_out_of_office=is_out_of_office,
        )

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        permanent: bool = False,
        recurrence_edit_scope: RecurrenceEditScope | None = None,
        occurrence_date: date | None = None,
    ) -> bool:
        return await EventDeleteOperations(self).delete(
            user_id,
            organization_id,
            event_id,
            permanent,
            recurrence_edit_scope,
            occurrence_date,
        )

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

    @staticmethod
    def _parse_master_event_id(event_id: UUID | str) -> UUID:
        return RecurrenceQueryOperations._parse_master_event_id(event_id)

    @staticmethod
    def _collect_update_kwargs(**fields: object) -> dict:
        return RecurrenceQueryOperations._collect_update_kwargs(**fields)

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

    async def cancel_occurrence(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
    ) -> None:
        await RecurrenceMutationOperations(self).cancel_occurrence(
            user_id,
            organization_id,
            event_id,
            occurrence_date,
        )

    async def edit_single_occurrence(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
        **updates: object,
    ) -> CalendarEvent:
        return await RecurrenceMutationOperations(self).edit_single_occurrence(
            user_id,
            organization_id,
            event_id,
            occurrence_date,
            **updates,
        )

    async def edit_this_and_following(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
        **updates: object,
    ) -> CalendarEvent:
        return await RecurrenceMutationOperations(self).edit_this_and_following(
            user_id,
            organization_id,
            event_id,
            occurrence_date,
            **updates,
        )

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

    async def add_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
        role: AttendeeRole = AttendeeRole.REQUIRED,
    ) -> CalendarEvent:
        return await AttendeeOperations(self).add_attendees(
            user_id,
            organization_id,
            event_id,
            attendee_ids,
            role,
        )

    async def update_attendee_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        target_user_id: UUID,
        role: AttendeeRole,
    ) -> CalendarEvent:
        return await AttendeeOperations(self).update_attendee_role(
            user_id,
            organization_id,
            event_id,
            target_user_id,
            role,
        )

    async def remove_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
    ) -> CalendarEvent:
        return await AttendeeOperations(self).remove_attendees(
            user_id,
            organization_id,
            event_id,
            attendee_ids,
        )

    async def update_attendee_status(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        status: AttendeeStatus,
    ) -> bool:
        return await AttendeeOperations(self).update_attendee_status(
            user_id,
            organization_id,
            event_id,
            status,
        )

    async def _expand_group_attendees(
        self,
        acting_user_id: UUID,
        organization_id: UUID,
        attendee_ids: list[UUID],
    ) -> tuple[list[UUID], dict[UUID, UUID]]:
        return await AttendeeOperations(self)._expand_group_attendees(
            acting_user_id,
            organization_id,
            attendee_ids,
        )

    async def _sync_auto_created_room_members(
        self,
        event: CalendarEvent,
        *,
        added: list[UUID],
        removed: list[UUID],
    ) -> None:
        await AttendeeOperations(self)._sync_auto_created_room_members(
            event,
            added=added,
            removed=removed,
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

    async def _log_activity(
        self,
        event_id: UUID,
        actor_id: UUID,
        action: str,
        field_id: str | None = None,
        previous_value: str | None = None,
        new_value: str | None = None,
    ) -> EventActivity:
        return await EventActivityOperations(self)._log_activity(
            event_id,
            actor_id,
            action,
            field_id,
            previous_value,
            new_value,
        )

    async def _log_field_changes(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        before: dict[str, object],
    ) -> None:
        await EventActivityOperations(self)._log_field_changes(event, actor_id, before)

    @staticmethod
    def _activity_snapshot(event: CalendarEvent) -> dict[str, object]:
        return EventActivityOperations._activity_snapshot(event)

    async def _create_reminder_rows(
        self,
        event: CalendarEvent,
        user_ids: list[UUID],
        intervals: list[int],
    ) -> None:
        await ReminderStagingOperations(self)._create_reminder_rows(event, user_ids, intervals)

    async def _reschedule_master_reminder_rows(self, event: CalendarEvent) -> None:
        await ReminderStagingOperations(self)._reschedule_master_reminder_rows(event)

    async def _delete_reminder_rows(
        self,
        event_id: UUID,
        user_ids: list[UUID] | None = None,
    ) -> None:
        await ReminderStagingOperations(self)._delete_reminder_rows(event_id, user_ids)

    async def _copy_tag_assignments(
        self,
        *,
        organization_id: UUID,
        actor_id: UUID,
        source_event_id: UUID,
        target_event_id: UUID,
    ) -> None:
        await EventTagOperations(self)._copy_tag_assignments(
            organization_id=organization_id,
            actor_id=actor_id,
            source_event_id=source_event_id,
            target_event_id=target_event_id,
        )

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        return EventTagOperations(self)._tag_filter_subquery(tag_ids)

    async def _emit_cancellation_notification(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        occurrence_date: date | None = None,
    ) -> None:
        await EventNotifications(self)._emit_cancellation_notification(
            event,
            actor_id,
            organization_id,
            occurrence_date,
        )

    async def _emit_team_mention_notifications(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        team_ids: list[UUID],
        excluded_ids: set[UUID],
    ) -> None:
        await EventNotifications(self)._emit_team_mention_notifications(
            event,
            actor_id,
            organization_id,
            team_ids,
            excluded_ids,
        )

    async def _is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        return await ChannelBindingOperations(self)._is_org_admin(user_id, organization_id)

    async def _validate_channel_binding(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        await ChannelBindingOperations(self)._validate_channel_binding(
            user_id,
            organization_id,
            channel_id,
        )

    async def _apply_channel_binding_update(
        self,
        user_id: UUID,
        organization_id: UUID,
        event: CalendarEvent,
        channel_id: str | None,
        meeting_url_provided: bool,
        channel_auto_created: bool = False,
    ) -> None:
        await ChannelBindingOperations(self)._apply_channel_binding_update(
            user_id,
            organization_id,
            event,
            channel_id,
            meeting_url_provided,
            channel_auto_created,
        )
