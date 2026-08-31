"""Calendar operations."""

from datetime import UTC, date, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.errors import (
    NotFoundError,
    ValidationError,
)
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AttendeeRole,
    AttendeeStatus,
    ContentType,
    EventStatus,
    EventTransparency,
    EventVisibility,
    NotificationType,
    RecurrenceEditScope,
    RecurrencePattern,
)
from uniffy.domains.scheduling.rooms.events import EventBookingOperations
from uniffy.domains.search.rename import propagate_rename
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="scheduling.calendar.events.updates")


class EventUpdateOperations:
    def __init__(self, events: object) -> None:
        self.events = events

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
        """Update an existing event.

        Access-policy changes go through `permissions.v1.MembersService`.
        `status` is occurrence-scopable (a cancelled occurrence stays visible as
        an override row); `visibility`, `transparency`, and `is_out_of_office`
        apply to the whole series.
        """
        if recurrence_edit_scope and occurrence_date:
            scoped_to_occurrences = recurrence_edit_scope in (
                RecurrenceEditScope.THIS_EVENT,
                RecurrenceEditScope.THIS_AND_FOLLOWING,
            )
            if scoped_to_occurrences:
                real_event_id = self.events._parse_master_event_id(event_id)
                updates = self.events._collect_update_kwargs(
                    title=title,
                    description=description,
                    start_time=start_time,
                    end_time=end_time,
                    is_all_day=is_all_day,
                    timezone=timezone,
                    location=location,
                    meeting_url=meeting_url,
                    category_id=category_id,
                    is_focus_time=is_focus_time,
                    reminders=reminders,
                    status=status,
                )
                # Anything else in the request would previously be dropped on
                # the floor while the save reported success; refuse instead so
                # every caller (mobile, agent tools) learns the scope limit.
                unscopable = self.events._collect_update_kwargs(
                    calendar_id=calendar_id,
                    tag_ids=tag_ids,
                    linked_resources=linked_resources,
                    attendee_ids=attendee_ids,
                    room_id=room_id,
                    channel_id=channel_id,
                    visibility=visibility,
                    transparency=transparency,
                    is_out_of_office=is_out_of_office,
                )
                if recurrence_edit_scope == RecurrenceEditScope.THIS_AND_FOLLOWING:
                    if recurrence_config is not None:
                        updates["recurrence_config"] = recurrence_config
                elif recurrence_config is not None:
                    unscopable["recurrence_config"] = recurrence_config
                if unscopable:
                    scope_label = (
                        "a single occurrence"
                        if recurrence_edit_scope == RecurrenceEditScope.THIS_EVENT
                        else "this and following occurrences"
                    )
                    raise ValidationError(
                        "recurrence_edit_scope",
                        f"These changes cannot be applied to {scope_label}: "
                        f"{', '.join(sorted(unscopable))}. Apply them to the whole series.",
                    )
                if recurrence_edit_scope == RecurrenceEditScope.THIS_EVENT:
                    return await self.events.edit_single_occurrence(
                        user_id,
                        organization_id,
                        real_event_id,
                        occurrence_date,
                        **updates,
                    )
                return await self.events.edit_this_and_following(
                    user_id,
                    organization_id,
                    real_event_id,
                    occurrence_date,
                    **updates,
                )

        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, event)

        old_title = event.title
        old_start_time = event.start_time
        old_end_time = event.end_time
        activity_before = self.events._activity_snapshot(event)

        title_changed = title is not None and title != event.title

        old_mentioned: set[UUID] = set()
        old_mentioned_teams: set[UUID] = set()
        if description is not None:
            old_mentioned = extract_mentioned_user_ids(event.outgoing_references)
            old_mentioned_teams = set(extract_mentioned_team_ids(event.outgoing_references))

        if title is not None:
            event.title = title
        if description is not None:
            event.description = description
            event.outgoing_references = (
                extract_all_outgoing_references(description, organization_id) or None
            )
        if start_time is not None:
            event.start_time = start_time
        if end_time is not None:
            event.end_time = end_time
        if is_all_day is not None:
            event.is_all_day = is_all_day
        if timezone is not None:
            event.timezone = timezone
        if location is not None:
            event.location = location
        if meeting_url is not None:
            event.meeting_url = meeting_url
        await self.events._apply_channel_binding_update(
            user_id,
            organization_id,
            event,
            channel_id,
            meeting_url is not None,
            channel_auto_created=bool(channel_auto_created),
        )
        previous_calendar_id = event.calendar_id
        calendar_moved = calendar_id is not None and calendar_id != event.calendar_id
        if calendar_id is not None:
            event.calendar_id = calendar_id
        if category_id is not None:
            event.category_id = category_id
        if recurrence_config is not None:
            event.recurrence_config = recurrence_config
            if recurrence_config.get("pattern"):
                event.recurrence_pattern = RecurrencePattern(recurrence_config["pattern"])
        if is_focus_time is not None:
            event.is_focus_time = is_focus_time
        old_status = event.status
        if status is not None:
            event.status = status
        if visibility is not None:
            event.visibility = visibility
        if transparency is not None:
            event.transparency = transparency
        if is_out_of_office is not None:
            event.is_out_of_office = is_out_of_office
        if linked_resources is not None:
            event.linked_resources = linked_resources
        if reminders is not None:
            event.reminders = reminders

        reminders_changed = reminders is not None
        schedule_changed = start_time is not None or recurrence_config is not None
        if reminders_changed or schedule_changed:
            effective_reminders = reminders if reminders is not None else (event.reminders or [])
            await self.events._delete_reminder_rows(event.id)
            if effective_reminders:
                stmt = select(EventAttendee.user_id).where(
                    and_(
                        EventAttendee.event_id == event.id,
                        EventAttendee.status != AttendeeStatus.DECLINED,
                    )
                )
                result = await self.events.session.execute(stmt)
                active_user_ids = [row[0] for row in result.all()]
                if active_user_ids:
                    await self.events._create_reminder_rows(
                        event,
                        active_user_ids,
                        effective_reminders,
                    )

        became_cancelled = old_status != EventStatus.CANCELLED and (
            event.status == EventStatus.CANCELLED
        )
        became_active = old_status == EventStatus.CANCELLED and (
            event.status != EventStatus.CANCELLED
        )
        if became_cancelled:
            # A cancelled event must not remind anyone; mirrors the decline path.
            await self.events._delete_reminder_rows(event.id)
        elif became_active and event.reminders and not (reminders_changed or schedule_changed):
            stmt = select(EventAttendee.user_id).where(
                and_(
                    EventAttendee.event_id == event.id,
                    EventAttendee.status != AttendeeStatus.DECLINED,
                )
            )
            result = await self.events.session.execute(stmt)
            active_user_ids = [row[0] for row in result.all()]
            if active_user_ids:
                await self.events._create_reminder_rows(
                    event,
                    active_user_ids,
                    event.reminders,
                )

        newly_invited_ids: list[UUID] = []
        removed_attendee_ids: list[UUID] = []
        if attendee_ids is not None:
            attendee_ids, invited_via = await self.events._expand_group_attendees(
                user_id, organization_id, attendee_ids
            )
            stmt = select(EventAttendee).where(EventAttendee.event_id == event.id)
            result = await self.events.session.execute(stmt)
            existing_attendees = result.scalars().all()
            existing_map = {a.user_id: a for a in existing_attendees}

            current_ids = set(existing_map.keys())
            new_ids = set(attendee_ids)

            for uid in current_ids - new_ids:
                attendee = existing_map[uid]
                if attendee.user_id != event.organizer_id:
                    await self.events.session.delete(attendee)
                    removed_attendee_ids.append(uid)

            for uid in new_ids - current_ids:
                if uid != event.organizer_id:
                    attendee = EventAttendee(
                        event_id=event.id,
                        user_id=uid,
                        status=AttendeeStatus.PENDING,
                        role=AttendeeRole.REQUIRED,
                        invited_via_group_id=invited_via.get(uid),
                    )
                    self.events.session.add(attendee)
                    newly_invited_ids.append(uid)

        event.updated_at = datetime.now(UTC)

        await self.events._log_field_changes(event, user_id, activity_before)
        if newly_invited_ids:
            await self.events._log_activity(
                event.id,
                user_id,
                "attendees_added",
                new_value=",".join(str(uid) for uid in newly_invited_ids),
            )
        if removed_attendee_ids:
            await self.events._log_activity(
                event.id,
                user_id,
                "attendees_removed",
                previous_value=",".join(str(uid) for uid in removed_attendee_ids),
            )

        await self.events.session.commit()
        await self.events.session.refresh(event)

        if tag_ids is not None:
            tag_ops = TagOperations(self.events.session)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.events.content_type, event.id),
                tag_ids=tag_ids,
            )

        await self.events._index_for_search(event)
        await self.events.session.commit()

        # Rename propagation rewrites mention labels inside other people's
        # documents; a private event's title must not be written there.
        if title_changed and event.visibility != EventVisibility.PRIVATE:
            try:
                event_urn = build_content_urn(ContentType.CALENDAR_EVENT, event.id)
                await propagate_rename(
                    session=self.events.session,
                    organization_id=organization_id,
                    target_urn=event_urn,
                    new_label=event.title,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate calendar event rename to mentions", event_id=str(event_id)
                )

        if newly_invited_ids:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_INVITE,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Invited to: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=newly_invited_ids,
                )
            )

        if became_cancelled:
            await self.events._emit_cancellation_notification(event, user_id, organization_id)

        if description is not None:
            if attendee_ids is not None:
                current_attendee_ids = set(attendee_ids)
            else:
                stmt = select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)
                result = await self.events.session.execute(stmt)
                current_attendee_ids = set(result.scalars().all())
            excluded_from_mentions = {user_id} | current_attendee_ids

            new_mentioned = (
                extract_mentioned_user_ids(event.outgoing_references) - excluded_from_mentions
            )
            newly_mentioned = new_mentioned - old_mentioned
            if newly_mentioned:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CONTENT_MENTIONED,
                        organization_id=organization_id,
                        actor_id=user_id,
                        title=f"Mentioned you in: {event.title}",
                        source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                        target_user_ids=list(newly_mentioned),
                    )
                )

            await self.events._emit_team_mention_notifications(
                event,
                user_id,
                organization_id,
                [
                    tid
                    for tid in extract_mentioned_team_ids(event.outgoing_references)
                    if tid not in old_mentioned_teams
                ],
                excluded_from_mentions | newly_mentioned,
            )

        mention_changes: dict[str, str] = {}
        if event.title != old_title:
            mention_changes["title"] = event.title
        if event.start_time != old_start_time:
            mention_changes["start_time"] = event.start_time.isoformat()
        if event.end_time != old_end_time:
            mention_changes["end_time"] = event.end_time.isoformat()
        if event.status != old_status:
            mention_changes["event_status"] = event.status.value

        # The mention-state pubsub payload is gated per recipient on can_view
        # only; a private event's title must not ride it to share-grant viewers.
        if event.visibility == EventVisibility.PRIVATE:
            mention_changes.pop("title", None)

        if mention_changes:
            try:
                event_urn = build_content_urn(ContentType.CALENDAR_EVENT, event.id)
                await publish_mention_state(
                    organization_id=organization_id,
                    urn=event_urn,
                    changes=mention_changes,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to publish calendar event mention state change", event_id=str(event_id)
                )

        if room_id is not None:
            await EventBookingOperations(self.events.session).replace(
                user_id=user_id,
                organization_id=organization_id,
                event_id=event_id,
                room_id=UUID(room_id) if room_id else None,
                start_time=start_time or event.start_time,
                end_time=end_time or event.end_time,
                title=event.title,
            )

        if calendar_moved:
            await write_audit_event(
                self.events.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CALENDAR_EVENT_MOVED,
                resource_type=AuditResourceType.CALENDAR_EVENT,
                resource_id=event_id,
                details={
                    "previous_calendar_id": (
                        str(previous_calendar_id) if previous_calendar_id else None
                    ),
                    "new_calendar_id": str(event.calendar_id),
                },
            )
            await self.events.session.commit()

        await self.events._sync_auto_created_room_members(
            event, added=newly_invited_ids, removed=removed_attendee_ids
        )

        return event
