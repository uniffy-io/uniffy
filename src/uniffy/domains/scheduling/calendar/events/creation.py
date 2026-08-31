"""Calendar operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.errors import (
    ValidationError,
)
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    AttendeeRole,
    AttendeeStatus,
    ContentType,
    EventStatus,
    EventTransparency,
    EventVisibility,
    NotificationType,
    RecurrencePattern,
)
from uniffy.domains.scheduling.calendar.events.state import _StagedCalendarEventCreate
from uniffy.domains.scheduling.rooms.events import EventBookingOperations
from uniffy.domains.settings.operations import get_user_reminder_defaults
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="scheduling.calendar.events.creation")


class EventCreateOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session
        self.content_type = events.content_type

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
        """Create a new calendar event.

        Events are invite-only: the row is always OWNER_ONLY and visibility
        for non-organizers comes from the attendee floor in `_resolve_role`.
        """
        if transparency is None:
            # All-day entries have never blocked time; an out-of-office period
            # must, even when it spans whole days.
            transparency = (
                EventTransparency.TRANSPARENT
                if is_all_day and not is_out_of_office
                else EventTransparency.OPAQUE
            )
        booking_ops = EventBookingOperations(self.session) if room_id else None
        if booking_ops is not None and room_id is not None:
            await booking_ops.validate_room(
                user_id,
                organization_id,
                room_id,
                start_time,
                end_time,
            )

        if channel_id is not None:
            if meeting_url:
                raise ValidationError(
                    "channel_id",
                    "An event cannot have both a meeting URL and a channel binding.",
                )
            await self.events._validate_channel_binding(user_id, organization_id, channel_id)

        invited_via: dict[UUID, UUID] = {}
        if attendee_ids:
            attendee_ids, invited_via = await self.events._expand_group_attendees(
                user_id, organization_id, attendee_ids
            )

        outgoing_refs = (
            extract_all_outgoing_references(description, organization_id) if description else None
        )

        if reminders is None:
            reminders = await get_user_reminder_defaults(self.session, user_id)

        event = CalendarEvent(
            organization_id=organization_id,
            organizer_id=user_id,
            calendar_id=calendar_id,
            title=title,
            description=description,
            start_time=start_time,
            end_time=end_time,
            is_all_day=is_all_day,
            timezone=timezone,
            location=location,
            meeting_url=meeting_url,
            channel_id=channel_id,
            channel_auto_created=bool(channel_id) and channel_auto_created,
            category_id=category_id,
            access_mode=AccessMode.OWNER_ONLY,
            baseline_role=None,
            is_focus_time=is_focus_time,
            status=status,
            visibility=visibility,
            transparency=transparency,
            is_out_of_office=is_out_of_office,
            recurrence_pattern=recurrence_pattern,
            recurrence_config=recurrence_config,
            linked_resources=linked_resources,
            outgoing_references=outgoing_refs,
            reminders=reminders,
        )
        self.session.add(event)
        staged_tags = None
        try:
            await self.session.flush()

            self.session.add(
                EventAttendee(
                    event_id=event.id,
                    user_id=user_id,
                    status=AttendeeStatus.ACCEPTED,
                    role=AttendeeRole.ORGANIZER,
                    responded_at=datetime.now(UTC),
                )
            )

            for attendee_id in attendee_ids or []:
                if attendee_id == user_id:
                    continue
                requested_role = (attendee_roles or {}).get(attendee_id, AttendeeRole.REQUIRED)
                self.session.add(
                    EventAttendee(
                        event_id=event.id,
                        user_id=attendee_id,
                        status=AttendeeStatus.PENDING,
                        role=(
                            AttendeeRole.OPTIONAL
                            if requested_role == AttendeeRole.OPTIONAL
                            else AttendeeRole.REQUIRED
                        ),
                        invited_via_group_id=invited_via.get(attendee_id),
                    )
                )

            if reminders:
                reminder_user_ids = [user_id]
                reminder_user_ids.extend(aid for aid in attendee_ids or [] if aid != user_id)
                await self.events._create_reminder_rows(event, reminder_user_ids, reminders)

            await self.events._log_activity(event.id, user_id, "created")

            if tag_ids is not None:
                staged_tags = await TagOperations(self.session).stage_manual_tags(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(self.content_type, event.id),
                    tag_ids=tag_ids,
                )

            if booking_ops is not None and room_id is not None:
                await booking_ops.stage(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_id,
                    start_time=start_time,
                    end_time=end_time,
                    title=title,
                    event_id=event.id,
                )

            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(event)

        await self._finish_calendar_event_create_after_commit(
            _StagedCalendarEventCreate(event, staged_tags, tuple(attendee_ids or ()))
        )

        return event

    async def _finish_calendar_event_create_after_commit(
        self,
        staged: _StagedCalendarEventCreate,
    ) -> None:
        event = staged.event
        if staged.tags is not None:
            try:
                await TagOperations(self.session).finish_manual_tags_after_commit(staged.tags)
            except Exception:
                logger.opt(exception=True).warning(
                    "Calendar event created with degraded tag projection",
                    event_id=str(event.id),
                )

        try:
            await self.events._index_for_search(event, skip_member_lookup=True)
        except Exception:
            logger.opt(exception=True).warning(
                "Calendar event created with stale search projection",
                event_id=str(event.id),
            )

        invited = [
            attendee_id for attendee_id in staged.attendee_ids if attendee_id != event.owner_id
        ]
        if invited:
            await self.events._publish_attendee_access_change(
                event,
                invited,
                ContentAccessAction.GRANTED,
            )
            try:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CALENDAR_INVITE,
                        organization_id=event.organization_id,
                        actor_id=event.owner_id,
                        title=f"Invited to: {event.title}",
                        source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                        target_user_ids=invited,
                    )
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Calendar event created with degraded invite notifications",
                    event_id=str(event.id),
                )

        excluded_from_mentions = {event.owner_id, *staged.attendee_ids}
        mentioned_ids = (
            extract_mentioned_user_ids(event.outgoing_references) - excluded_from_mentions
        )
        if mentioned_ids:
            try:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CONTENT_MENTIONED,
                        organization_id=event.organization_id,
                        actor_id=event.owner_id,
                        title=f"Mentioned you in: {event.title}",
                        source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                        target_user_ids=list(mentioned_ids),
                    )
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Calendar event created with degraded mention notifications",
                    event_id=str(event.id),
                )

        try:
            await self.events._emit_team_mention_notifications(
                event,
                event.owner_id,
                event.organization_id,
                extract_mentioned_team_ids(event.outgoing_references),
                excluded_from_mentions | mentioned_ids,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Calendar event created with degraded team-mention notifications",
                event_id=str(event.id),
            )
