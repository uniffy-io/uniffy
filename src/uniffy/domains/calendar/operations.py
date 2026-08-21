"""Calendar operations."""

import copy
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import String, and_, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions import resolve_access_policy
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import register_content_loader
from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    AttendeeRole,
    AttendeeStatus,
    ContentRole,
    ContentType,
    NotificationType,
    RecurrenceEditScope,
    RecurrencePattern,
    SortOrder,
)
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.calendar import queries
from uniffy.domains.calendar.recurrence import (
    OCCURRENCE_ID_SEPARATOR,
    expand_recurrence,
    occurrence_start_for_date,
)
from uniffy.domains.tags import TagAssignment, TagOperations

logger = logger.bind(component="calendar.operations")


_ACTIVITY_VALUE_LIMIT = 500

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
)


def _activity_value(value: object) -> str | None:
    """Render a field value for the activity log, or None when there is nothing to show."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return ",".join(str(item) for item in value) or None
    return str(value)[:_ACTIVITY_VALUE_LIMIT]


def _master_event_id(event: CalendarEvent) -> UUID:
    """Strip `__occurrence__{date}` from a synthetic recurring-instance id.

    Tag assignments live on the master event row; recurring instances are
    virtual and must resolve to the master so the tag pipeline stays consistent.
    """
    raw = str(event.id)
    if OCCURRENCE_ID_SEPARATOR in raw:
        return UUID(raw.split(OCCURRENCE_ID_SEPARATOR)[0])
    return event.id if isinstance(event.id, UUID) else UUID(raw)


class CalendarEventOperations(BaseContentOperations[CalendarEvent]):
    """Calendar event CRUD with permissions, search, and attendees."""

    content_type = ContentType.CALENDAR_EVENT
    model_class = CalendarEvent

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    def _build_search_keywords(self, model: CalendarEvent) -> str:
        # Tag slugs land in the dedicated `tags` array via
        # `_get_search_tags_async`; not duplicated here.
        parts = [model.title]
        if model.description:
            parts.append(model.description)
        if model.location:
            parts.append(model.location)
        return " ".join(parts)

    def _get_search_title(self, model: CalendarEvent) -> str:
        return model.title

    def _get_url_path(self, model: CalendarEvent) -> str:
        return f"/calendar?event={model.id}"

    def _get_search_description(self, model: CalendarEvent) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    async def _get_search_tags_async(self, model: CalendarEvent) -> list[str] | None:
        # Recurring instances inherit the master's tag set; resolve to master.
        urn = build_content_urn(self.content_type, _master_event_id(model))
        tag_ops = TagOperations(self.session)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _get_search_metadata(self, model: CalendarEvent) -> dict[str, str] | None:
        """Return event details metadata for search."""
        metadata: dict[str, str] = {}
        if model.start_time:
            metadata["start_time"] = model.start_time.isoformat()
        if model.end_time:
            metadata["end_time"] = model.end_time.isoformat()
        if model.location:
            metadata["location"] = model.location
        if model.timezone:
            metadata["timezone"] = model.timezone
        metadata["is_all_day"] = str(model.is_all_day).lower()
        return metadata if metadata else None

    def _get_owner_id_column(self) -> InstrumentedAttribute:
        """Events use `organizer_id` instead of `owner_id`."""
        return CalendarEvent.organizer_id

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: CalendarEvent,
    ) -> ContentRole | None:
        """Content permissions first, then the attendee floor.

        An invitation is an explicit grant by the organizer, so an attendee can
        VIEW an event regardless of its access mode - mirroring the attendee
        bypass in the list queries. An explicit BLOCKED grant still wins.
        """
        # Expanded occurrences carry a synthetic string id; permissions live on
        # the master row, so every lookup below resolves to the master UUID.
        master_id = _master_event_id(content)
        role = await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id=master_id,
            owner_id=content.owner_id,
            access_mode=content.access_mode,
            baseline_role=content.baseline_role,
        )
        if role is not None:
            return role

        if not await self._is_attendee(user_id, organization_id, master_id):
            return None

        if await self.permission_checker.is_blocked(
            user_id, organization_id, self.content_type, master_id
        ):
            return None

        return ContentRole.VIEWER

    async def _is_attendee(self, user_id: UUID, organization_id: UUID, event_id: UUID) -> bool:
        """An invitation is a grant only while the invitee is still an active
        member of the org.

        ``effective_role`` has already returned ``None`` by the time this runs,
        and lost membership is one of the reasons it does. Without the join,
        removal would leave every event the user was ever invited to readable,
        because ``remove_member`` does not delete attendee rows.
        """
        if not await self.access_query.is_active_member(user_id, organization_id):
            return False

        result = await self.session.execute(
            select(EventAttendee.id)
            .where(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == user_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def _attendee_access_filter(self, user_id: UUID, organization_id: UUID):
        """WHERE branch granting invitees visibility, minus explicit BLOCKED grants.

        The membership EXISTS is uncorrelated, so it collapses to a constant
        for the query rather than running per row. It mirrors the same
        condition in ``_is_attendee``.
        """
        attendee_subquery = select(EventAttendee.event_id).where(
            EventAttendee.user_id == user_id,
        )
        if not await self.access_query.is_active_member(user_id, organization_id):
            return False
        return and_(
            CalendarEvent.id.in_(attendee_subquery),
            self.access_query.build_not_blocked_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=CalendarEvent.id,
            ),
        )

    async def _get_search_attendee_user_ids(self, model: CalendarEvent) -> list[UUID] | None:
        # Recurring instances resolve to the master, same as tags; override rows
        # carry their own copied attendee set.
        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == _master_event_id(model))
        )
        ids = [row[0] for row in result.all()]
        return ids or None

    async def _refresh_search_attendees(self, event: CalendarEvent) -> None:
        """Push the current attendee set into the search document; best-effort."""
        try:
            attendee_ids = await self._get_search_attendee_user_ids(event)
            await self.search_indexer.update_attendees(
                urn=build_content_urn(self.content_type, event.id),
                organization_id=event.organization_id,
                attendee_user_ids=attendee_ids or [],
            )
        except Exception:
            logger.opt(exception=True).warning("Failed to refresh attendee search sharing")

    async def _emit_team_mention_notifications(
        self,
        event: CalendarEvent,
        actor_id: UUID,
        organization_id: UUID,
        team_ids: list[UUID],
        excluded_ids: set[UUID],
    ) -> None:
        """One CONTENT_MENTIONED per newly mentioned team; the notification
        worker filters each recipient against the event itself."""
        if not team_ids:
            return
        notified = set(excluded_ids)
        expansions = await expand_team_mentions(self.session, organization_id, team_ids)
        for expansion in expansions:
            targets = [uid for uid in expansion.member_ids if uid not in notified]
            if not targets:
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned {expansion.name} in: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=targets,
                    metadata={
                        "team_id": str(expansion.team_id),
                        "team_name": expansion.name,
                    },
                )
            )
            notified.update(targets)

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
        recurrence_pattern: RecurrencePattern = RecurrencePattern.NONE,
        recurrence_config: dict | None = None,
        is_focus_time: bool = False,
        tag_ids: list[UUID] | None = None,
        linked_resources: list[dict] | None = None,
        reminders: list[int] | None = None,
        room_id: UUID | None = None,
        channel_id: UUID | None = None,
        channel_auto_created: bool = False,
    ) -> CalendarEvent:
        """Create a new calendar event.

        Events are invite-only: the row is always OWNER_ONLY and visibility
        for non-organizers comes from the attendee floor in `_resolve_role`.
        """
        if room_id:
            # Detect the conflict before the event is committed so the
            # composite create_event(..., room_id=...) flow doesn't leave
            # an orphan event behind on a booking collision.
            from uniffy.core.types import RoomStatus
            from uniffy.domains.rooms import queries as room_queries
            from uniffy.domains.rooms.operations import RoomOperations

            room_ops = RoomOperations(self.session)
            room = await room_ops.get_by_id(user_id, organization_id, room_id)
            if room.status != RoomStatus.ACTIVE:
                raise ValidationError(
                    "room",
                    f"Room '{room.name}' is not available for booking "
                    f"(status: {room.status.value}).",
                )
            if await room_queries.check_booking_conflict(
                self.session, room_id, start_time, end_time
            ):
                raise ValidationError("room", "Room is already booked for this time slot.")

        if channel_id is not None:
            if meeting_url:
                raise ValidationError(
                    "channel_id",
                    "An event cannot have both a meeting URL and a channel binding.",
                )
            await self._validate_channel_binding(user_id, organization_id, channel_id)

        invited_via: dict[UUID, UUID] = {}
        if attendee_ids:
            attendee_ids, invited_via = await self._expand_group_attendees(
                user_id, organization_id, attendee_ids
            )

        outgoing_refs = (
            extract_all_outgoing_references(description, organization_id) if description else None
        )

        if reminders is None:
            from uniffy.domains.settings.defaults import DEFAULT_REMINDER_INTERVALS

            reminders = list(DEFAULT_REMINDER_INTERVALS)

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
            recurrence_pattern=recurrence_pattern,
            recurrence_config=recurrence_config,
            linked_resources=linked_resources,
            outgoing_references=outgoing_refs,
            reminders=reminders,
        )
        self.session.add(event)
        await self.session.flush()

        organizer_attendee = EventAttendee(
            event_id=event.id,
            user_id=user_id,
            status=AttendeeStatus.ACCEPTED,
            role=AttendeeRole.ORGANIZER,
            responded_at=datetime.now(UTC),
        )
        self.session.add(organizer_attendee)

        if attendee_ids:
            for attendee_id in attendee_ids:
                if attendee_id != user_id:
                    attendee = EventAttendee(
                        event_id=event.id,
                        user_id=attendee_id,
                        status=AttendeeStatus.PENDING,
                        role=AttendeeRole.REQUIRED,
                        invited_via_group_id=invited_via.get(attendee_id),
                    )
                    self.session.add(attendee)

        if reminders:
            reminder_user_ids = [user_id]
            if attendee_ids:
                reminder_user_ids.extend(aid for aid in attendee_ids if aid != user_id)
            await self._create_reminder_rows(
                event_id=event.id,
                user_ids=reminder_user_ids,
                intervals=reminders,
                start_time=start_time,
            )

        await self._log_activity(event.id, user_id, "created")

        await self.session.commit()
        await self.session.refresh(event)

        if tag_ids:
            tag_ops = TagOperations(self.session)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, event.id),
                tag_ids=tag_ids,
            )

        await self._index_for_search(event, skip_member_lookup=True)
        await self.session.commit()

        if attendee_ids:
            invited = [aid for aid in attendee_ids if aid != user_id]
            if invited:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CALENDAR_INVITE,
                        organization_id=organization_id,
                        actor_id=user_id,
                        title=f"Invited to: {event.title}",
                        source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                        target_user_ids=invited,
                    )
                )

        excluded_from_mentions = {user_id} | set(attendee_ids or [])
        mentioned_ids = extract_mentioned_user_ids(outgoing_refs) - excluded_from_mentions
        if mentioned_ids:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Mentioned you in: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=list(mentioned_ids),
                )
            )

        await self._emit_team_mention_notifications(
            event,
            user_id,
            organization_id,
            extract_mentioned_team_ids(outgoing_refs),
            excluded_from_mentions | mentioned_ids,
        )

        if room_id:
            from uniffy.domains.rooms.operations import BookingOperations

            booking_ops = BookingOperations(self.session)
            await booking_ops.create_booking(
                user_id=user_id,
                organization_id=organization_id,
                room_id=room_id,
                start_time=start_time,
                end_time=end_time,
                title=title,
                event_id=event.id,
            )

        return event

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
    ) -> CalendarEvent:
        """Update an existing event.

        Access-policy changes go through `permissions.v1.MembersService`.
        """
        if recurrence_edit_scope and occurrence_date:
            if recurrence_edit_scope == RecurrenceEditScope.THIS_EVENT:
                real_event_id = self._parse_master_event_id(event_id)
                updates = self._collect_update_kwargs(
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
                )
                return await self.edit_single_occurrence(
                    user_id,
                    organization_id,
                    real_event_id,
                    occurrence_date,
                    **updates,
                )
            elif recurrence_edit_scope == RecurrenceEditScope.THIS_AND_FOLLOWING:
                real_event_id = self._parse_master_event_id(event_id)
                updates = self._collect_update_kwargs(
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
                )
                return await self.edit_this_and_following(
                    user_id,
                    organization_id,
                    real_event_id,
                    occurrence_date,
                    **updates,
                )

        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        old_title = event.title
        old_start_time = event.start_time
        old_end_time = event.end_time
        activity_before = self._activity_snapshot(event)

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
        await self._apply_channel_binding_update(
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
        if linked_resources is not None:
            event.linked_resources = linked_resources
        if reminders is not None:
            event.reminders = reminders

        reminders_changed = reminders is not None
        start_changed = start_time is not None
        if reminders_changed or start_changed:
            effective_start = start_time if start_time is not None else event.start_time
            effective_reminders = reminders if reminders is not None else (event.reminders or [])
            await self._delete_reminder_rows(event.id)
            if effective_reminders:
                stmt = select(EventAttendee.user_id).where(
                    and_(
                        EventAttendee.event_id == event.id,
                        EventAttendee.status != AttendeeStatus.DECLINED,
                    )
                )
                result = await self.session.execute(stmt)
                active_user_ids = [row[0] for row in result.all()]
                if active_user_ids:
                    await self._create_reminder_rows(
                        event_id=event.id,
                        user_ids=active_user_ids,
                        intervals=effective_reminders,
                        start_time=effective_start,
                    )

        newly_invited_ids: list[UUID] = []
        removed_attendee_ids: list[UUID] = []
        if attendee_ids is not None:
            attendee_ids, invited_via = await self._expand_group_attendees(
                user_id, organization_id, attendee_ids
            )
            stmt = select(EventAttendee).where(EventAttendee.event_id == event.id)
            result = await self.session.execute(stmt)
            existing_attendees = result.scalars().all()
            existing_map = {a.user_id: a for a in existing_attendees}

            current_ids = set(existing_map.keys())
            new_ids = set(attendee_ids)

            for uid in current_ids - new_ids:
                attendee = existing_map[uid]
                if attendee.user_id != event.organizer_id:
                    await self.session.delete(attendee)
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
                    self.session.add(attendee)
                    newly_invited_ids.append(uid)

        event.updated_at = datetime.now(UTC)

        await self._log_field_changes(event, user_id, activity_before)
        if newly_invited_ids:
            await self._log_activity(
                event.id,
                user_id,
                "attendees_added",
                new_value=",".join(str(uid) for uid in newly_invited_ids),
            )
        if removed_attendee_ids:
            await self._log_activity(
                event.id,
                user_id,
                "attendees_removed",
                previous_value=",".join(str(uid) for uid in removed_attendee_ids),
            )

        await self.session.commit()
        await self.session.refresh(event)

        if tag_ids is not None:
            tag_ops = TagOperations(self.session)
            await tag_ops.replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, event.id),
                tag_ids=tag_ids,
            )

        await self._index_for_search(event)
        await self.session.commit()

        if title_changed:
            try:
                event_urn = build_content_urn(ContentType.CALENDAR_EVENT, event.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=event_urn,
                    new_label=event.title,
                )
                await self.session.commit()
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

        if description is not None:
            if attendee_ids is not None:
                current_attendee_ids = set(attendee_ids)
            else:
                stmt = select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)
                result = await self.session.execute(stmt)
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

            await self._emit_team_mention_notifications(
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
            from uniffy.domains.rooms.operations import BookingOperations

            booking_ops = BookingOperations(self.session)
            await booking_ops.cancel_booking_for_event(event_id)
            if room_id:
                room_uuid = UUID(room_id) if isinstance(room_id, str) else room_id
                final_start = start_time or event.start_time
                final_end = end_time or event.end_time
                await booking_ops.create_booking(
                    user_id=user_id,
                    organization_id=organization_id,
                    room_id=room_uuid,
                    start_time=final_start,
                    end_time=final_end,
                    title=event.title,
                    event_id=event_id,
                )

        if calendar_moved:
            await write_audit_event(
                self.session,
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
            await self.session.commit()

        await self._sync_auto_created_room_members(
            event, added=newly_invited_ids, removed=removed_attendee_ids
        )

        return event

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
                real_event_id = self._parse_master_event_id(event_id)
                await self.cancel_occurrence(
                    user_id,
                    organization_id,
                    real_event_id,
                    occurrence_date,
                )
                return True
            elif recurrence_edit_scope == RecurrenceEditScope.THIS_AND_FOLLOWING:
                real_event_id = self._parse_master_event_id(event_id)
                master = await self._fetch_by_id(real_event_id, organization_id)
                if not master:
                    raise NotFoundError("CalendarEvent", real_event_id)
                await self._require_delete(user_id, organization_id, master)
                config = dict(master.recurrence_config or {})
                end_dt = datetime(
                    occurrence_date.year,
                    occurrence_date.month,
                    occurrence_date.day,
                    tzinfo=master.start_time.tzinfo,
                ) - timedelta(days=1)
                config["end_date"] = end_dt.isoformat()
                master.recurrence_config = config
                master.updated_at = datetime.now(UTC)
                await self.session.commit()
                return True

        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_delete(user_id, organization_id, event)

        await self.session.execute(delete(EventReminder).where(EventReminder.event_id == event_id))

        from uniffy.domains.rooms.operations import BookingOperations

        booking_ops = BookingOperations(self.session)
        await booking_ops.cancel_booking_for_event(event_id)

        if permanent:
            tag_ops = TagOperations(self.session)
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

        return True

    async def get_events_in_range(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_date: datetime,
        end_date: datetime,
        calendar_ids: list[UUID] | None = None,
        category_ids: list[UUID] | None = None,
    ) -> list[CalendarEvent]:
        """Get events the user can access in a date range.

        Combines the canonical accessible-filter with an attendee bypass
        so invitees always see events they are on.
        """
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
            await self._attendee_access_filter(user_id, organization_id),
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
            exc_result = await self.session.execute(
                select(RecurrenceException).where(RecurrenceException.event_id.in_(recurring_ids))
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

    async def cancel_occurrence(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        occurrence_date: date,
    ) -> None:
        """Cancel a single occurrence of a recurring event."""
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        if event.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        exception = RecurrenceException(
            event_id=event_id,
            original_date=occurrence_date,
            is_cancelled=True,
        )
        self.session.add(exception)

        await self._log_activity(
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
        master = await self._fetch_by_id(event_id, organization_id)
        if not master:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, master)

        if master.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        # Only the explicitly requested fields are diffed; the override's own
        # start/end come from the occurrence date, which is not a user edit.
        edited_before = {
            name: value for name, value in self._activity_snapshot(master).items() if name in updates
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

        await self._copy_tag_assignments(
            organization_id=organization_id,
            actor_id=user_id,
            source_event_id=master.id,
            target_event_id=override.id,
        )

        await self._log_activity(
            master.id,
            user_id,
            "recurrence_changed",
            field_id="occurrence_override",
            new_value=occurrence_date.isoformat(),
        )
        await self._log_activity(override.id, user_id, "created")
        await self._log_field_changes(override, user_id, edited_before)

        await self._index_for_search(override, skip_member_lookup=True)
        await self.session.commit()

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
        master = await self._fetch_by_id(event_id, organization_id)
        if not master:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, master)

        if master.recurrence_pattern == RecurrencePattern.NONE:
            raise NotFoundError("Not a recurring event", event_id)

        edited_before = {
            name: value for name, value in self._activity_snapshot(master).items() if name in updates
        }

        config = dict(master.recurrence_config or {})
        end_dt = datetime(
            occurrence_date.year,
            occurrence_date.month,
            occurrence_date.day,
            tzinfo=master.start_time.tzinfo,
        ) - timedelta(days=1)
        config["end_date"] = end_dt.isoformat()
        master.recurrence_config = config
        master.updated_at = datetime.now(UTC)

        duration = master.end_time - master.start_time
        new_start = occurrence_start_for_date(
            master.start_time, master.timezone or "UTC", occurrence_date
        )
        new_end = new_start + duration

        new_config = dict(master.recurrence_config or {})
        original_end = (master.recurrence_config or {}).get("end_date")
        if original_end and original_end != config["end_date"]:
            new_config["end_date"] = original_end
        else:
            new_config.pop("end_date", None)

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
            linked_resources=master.linked_resources,
            recurrence_pattern=master.recurrence_pattern,
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

        await self._copy_tag_assignments(
            organization_id=organization_id,
            actor_id=user_id,
            source_event_id=master.id,
            target_event_id=new_event.id,
        )

        await self._log_activity(
            master.id,
            user_id,
            "recurrence_changed",
            field_id="series_split",
            new_value=occurrence_date.isoformat(),
        )
        await self._log_activity(new_event.id, user_id, "created")
        await self._log_field_changes(new_event, user_id, edited_before)

        await self._index_for_search(new_event, skip_member_lookup=True)
        await self.session.commit()

        return new_event

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
        """List events the user can access with filters/pagination."""
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
                await self._attendee_access_filter(user_id, organization_id),
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
            query = query.where(CalendarEvent.id.in_(self._tag_filter_subquery(tag_ids)))

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
        event = await self.get_by_id(user_id, organization_id, event_id)
        attendees = await queries.get_event_attendees(self.session, event_id)
        return event, attendees

    async def add_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
        role: AttendeeRole = AttendeeRole.REQUIRED,
    ) -> CalendarEvent:
        """Add attendees to an existing event."""
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        attendee_ids, invited_via = await self._expand_group_attendees(
            user_id, organization_id, attendee_ids
        )

        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == event_id)
        )
        existing_ids = {row[0] for row in result.all()}

        added_ids: list[UUID] = []
        for attendee_id in attendee_ids:
            if attendee_id not in existing_ids:
                attendee = EventAttendee(
                    event_id=event_id,
                    user_id=attendee_id,
                    status=AttendeeStatus.PENDING,
                    role=role,
                    invited_via_group_id=invited_via.get(attendee_id),
                )
                self.session.add(attendee)
                added_ids.append(attendee_id)

        if added_ids and event.reminders:
            await self._create_reminder_rows(
                event_id=event_id,
                user_ids=added_ids,
                intervals=event.reminders,
                start_time=event.start_time,
            )

        event.updated_at = datetime.now(UTC)

        if added_ids:
            await self._log_activity(
                event_id,
                user_id,
                "attendees_added",
                new_value=",".join(str(uid) for uid in added_ids),
            )

        await self.session.commit()
        await self.session.refresh(event)

        if added_ids:
            await self._refresh_search_attendees(event)
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_INVITE,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Invited to: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=added_ids,
                )
            )

        await self._sync_auto_created_room_members(event, added=added_ids, removed=[])

        return event

    async def remove_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
    ) -> CalendarEvent:
        """Remove attendees from an event."""
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self._require_edit(user_id, organization_id, event)

        if event.organizer_id in attendee_ids:
            raise PermissionDeniedError("remove", "event organizer")

        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id.in_(attendee_ids),
                )
            )
        )
        removed_ids: list[UUID] = []
        for attendee in result.scalars().all():
            removed_ids.append(attendee.user_id)
            await self.session.delete(attendee)

        await self._delete_reminder_rows(event_id, user_ids=attendee_ids)

        event.updated_at = datetime.now(UTC)

        if removed_ids:
            await self._log_activity(
                event_id,
                user_id,
                "attendees_removed",
                previous_value=",".join(str(uid) for uid in removed_ids),
            )

        await self.session.commit()
        await self.session.refresh(event)

        if removed_ids:
            await self._refresh_search_attendees(event)

        await self._sync_auto_created_room_members(event, added=[], removed=removed_ids)

        return event

    async def update_attendee_status(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        status: AttendeeStatus,
    ) -> bool:
        """Update the current user's attendee status for an event."""
        event = await self._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id == user_id,
                )
            )
        )
        attendee = result.scalar_one_or_none()
        if not attendee:
            raise NotFoundError("EventAttendee", user_id)

        old_status = attendee.status
        attendee.status = status
        attendee.responded_at = datetime.now(UTC)
        attendee.updated_at = datetime.now(UTC)

        if status == AttendeeStatus.DECLINED:
            await self._delete_reminder_rows(event_id, user_ids=[user_id])
        elif (
            old_status == AttendeeStatus.DECLINED
            and status in (AttendeeStatus.ACCEPTED, AttendeeStatus.TENTATIVE)
            and event.reminders
        ):
            await self._create_reminder_rows(
                event_id=event_id,
                user_ids=[user_id],
                intervals=event.reminders,
                start_time=event.start_time,
            )

        if old_status != status:
            await self._log_activity(
                event_id,
                user_id,
                "response_changed",
                field_id="status",
                previous_value=old_status.value,
                new_value=status.value,
            )

        await self.session.commit()

        if event.organizer_id != user_id:
            status_label = status.value.lower()
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_RESPONSE,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"RSVP {status_label}: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=[event.organizer_id],
                )
            )

        return True

    async def list_activities(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[EventActivity], int]:
        """Read an event's activity log, newest first. Requires VIEW on the event."""
        master_id = self._parse_master_event_id(event_id)
        event = await self._fetch_by_id(master_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", master_id)

        await self._require_view(user_id, organization_id, event)

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
            event_id=self._parse_master_event_id(event_id),
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
    ) -> None:
        """Emit one activity entry per tracked field that actually changed."""
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

    @staticmethod
    def _activity_snapshot(event: CalendarEvent) -> dict[str, object]:
        return {
            field_name: copy.deepcopy(getattr(event, field_name, None))
            for field_name, _, _ in _ACTIVITY_TRACKED_FIELDS
        }

    async def _create_reminder_rows(
        self,
        event_id: UUID,
        user_ids: list[UUID],
        intervals: list[int],
        start_time: datetime,
    ) -> None:
        now = datetime.now(UTC)
        for user_id in user_ids:
            for minutes in intervals:
                scheduled_at = start_time - timedelta(minutes=minutes)
                if scheduled_at <= now:
                    continue
                reminder = EventReminder(
                    event_id=event_id,
                    user_id=user_id,
                    minutes_before=minutes,
                    scheduled_at=scheduled_at,
                )
                self.session.add(reminder)

    async def _copy_tag_assignments(
        self,
        *,
        organization_id: UUID,
        actor_id: UUID,
        source_event_id: UUID,
        target_event_id: UUID,
    ) -> None:
        """Copy manual tag assignments from one event URN to another."""
        tag_ops = TagOperations(self.session)
        source_urn = build_content_urn(self.content_type, source_event_id)
        target_urn = build_content_urn(self.content_type, target_event_id)
        bulk = await tag_ops.get_for_urns(
            organization_id=organization_id,
            content_urns=[source_urn],
        )
        tag_ids = [tag.id for tag in bulk.get(source_urn, [])]
        if not tag_ids:
            return
        await tag_ops.assign(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=target_urn,
            tag_ids=tag_ids,
        )

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Event ids that carry every tag id in `tag_ids` (logical AND)."""
        urn_prefix = "urn:uniffy:content:CALENDAR_EVENT:"
        urn_expr = func.concat(urn_prefix, cast(CalendarEvent.id, String))
        return (
            select(CalendarEvent.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(CalendarEvent.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _delete_reminder_rows(
        self,
        event_id: UUID,
        user_ids: list[UUID] | None = None,
    ) -> None:
        stmt = delete(EventReminder).where(
            and_(
                EventReminder.event_id == event_id,
                EventReminder.sent_at.is_(None),
            )
        )
        if user_ids is not None:
            stmt = stmt.where(EventReminder.user_id.in_(user_ids))
        await self.session.execute(stmt)

    async def _expand_group_attendees(
        self,
        acting_user_id: UUID,
        organization_id: UUID,
        attendee_ids: list[UUID],
    ) -> tuple[list[UUID], dict[UUID, UUID]]:
        """Replace group ids with their active rosters, then keep only active org members.

        A group expands only from this org, and a private group only for an
        actor who can see its roster (group member or org admin) - reported
        as "not found" so existence does not leak. Ids that are neither an
        org group nor an active org member are dropped.

        Returns ``(resolved ids, user_id -> source group id)``. Direct user
        ids stay out of the map; a user in two invited groups keeps the first.
        """
        if not attendee_ids:
            return [], {}

        from uniffy.core.models.login.group import Group
        from uniffy.core.models.login.group_member import GroupMember

        result = await self.session.execute(
            select(Group.id, Group.is_private).where(
                Group.id.in_(attendee_ids),
                Group.organization_id == organization_id,
            )
        )
        groups = {row[0]: row[1] for row in result.all()}
        group_ids = set(groups)

        if group_ids:
            private_ids = {gid for gid, is_private in groups.items() if is_private}
            if private_ids and not await self._is_org_admin(acting_user_id, organization_id):
                memberships = await self.session.execute(
                    select(GroupMember.group_id).where(
                        GroupMember.group_id.in_(private_ids),
                        GroupMember.user_id == acting_user_id,
                        GroupMember.is_active.is_(True),
                    )
                )
                visible = {row[0] for row in memberships.all()}
                hidden = private_ids - visible
                if hidden:
                    raise ValidationError("attendees", "group not found")

            result = await self.session.execute(
                select(GroupMember.group_id, GroupMember.user_id).where(
                    and_(
                        GroupMember.group_id.in_(group_ids),
                        GroupMember.is_active.is_(True),
                    )
                )
            )
            members_by_group: dict[UUID, list[UUID]] = {}
            for gid, uid in result.all():
                members_by_group.setdefault(gid, []).append(uid)
        else:
            members_by_group = {}

        seen: set[UUID] = set()
        resolved: list[UUID] = []
        provenance: dict[UUID, UUID] = {}
        for uid in attendee_ids:
            if uid in group_ids:
                continue
            if uid not in seen:
                seen.add(uid)
                resolved.append(uid)
        for gid in attendee_ids:
            if gid not in group_ids:
                continue
            for uid in members_by_group.get(gid, []):
                if uid not in seen:
                    seen.add(uid)
                    resolved.append(uid)
                    provenance[uid] = gid

        if not resolved:
            return [], {}
        active = await self.session.execute(
            select(OrganizationMember.user_id)
            .join(User, User.id == OrganizationMember.user_id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id.in_(resolved),
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
        )
        active_ids = {row[0] for row in active.all()}
        return (
            [uid for uid in resolved if uid in active_ids],
            {uid: gid for uid, gid in provenance.items() if uid in active_ids},
        )

    async def _is_org_admin(self, user_id: UUID, organization_id: UUID) -> bool:
        membership = await get_active_membership(self.session, user_id, organization_id)
        return membership is not None and membership.role in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        )

    async def _validate_channel_binding(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
    ) -> None:
        """Verify the organizer may bind an event to ``channel_id``.

        ``get_channel`` already scopes to the org and rejects deleted channels;
        this additionally rejects archived channels and requires the caller to
        pass the chat access check. Join stays gated per user at call time, so
        no attendee membership is inspected here.
        """
        from uniffy.domains.chat.access import ChatAccessChecker

        checker = ChatAccessChecker(self.session)
        channel = await checker.get_channel(channel_id, organization_id)
        if channel.is_archived:
            raise ValidationError("channel_id", "Channel is archived.")
        await checker.check_access(user_id, organization_id, channel)

    async def _apply_channel_binding_update(
        self,
        user_id: UUID,
        organization_id: UUID,
        event: CalendarEvent,
        channel_id: str | None,
        meeting_url_provided: bool,
        channel_auto_created: bool = False,
    ) -> None:
        """Apply a channel binding change on update and enforce mutual exclusion.

        ``channel_id`` unset leaves the binding untouched, empty string clears
        it, and a uuid string binds after validation. An event is either a link
        meeting or a channel meeting, never both.
        """
        if channel_id is not None:
            if channel_id == "":
                event.channel_id = None
                event.channel_auto_created = False
            else:
                new_channel_id = UUID(channel_id)
                await self._validate_channel_binding(user_id, organization_id, new_channel_id)
                if event.channel_id != new_channel_id:
                    # A new binding takes the caller's flag: True for a room the
                    # editor auto-created, False for a picked channel.
                    event.channel_auto_created = channel_auto_created
                event.channel_id = new_channel_id
        if (meeting_url_provided or channel_id is not None) and (
            event.channel_id is not None and event.meeting_url
        ):
            raise ValidationError(
                "channel_id",
                "An event cannot have both a meeting URL and a channel binding.",
            )

    async def _sync_auto_created_room_members(
        self,
        event: CalendarEvent,
        *,
        added: list[UUID],
        removed: list[UUID],
    ) -> None:
        """Mirror attendee changes into a room the editor auto-created.

        Only auto-created rooms are synced; a channel the organizer merely
        picked is never mutated by the calendar. The organizer owns the room,
        so the chat member ops run as the organizer. Best-effort: a chat-side
        failure leaves the event saved and logs, since join is gated per user
        at call time. Auto-created rooms are always PRIVATE channels (GROUP_DM
        membership is immutable), so add/remove always apply.
        """
        if not (event.channel_auto_created and event.channel_id):
            return
        add = [uid for uid in added if uid != event.organizer_id]
        remove = [uid for uid in removed if uid != event.organizer_id]
        if not add and not remove:
            return

        from uniffy.domains.chat.channels.operations import ChatChannelOperations

        chat_ops = ChatChannelOperations(self.session)
        try:
            if add:
                await chat_ops.add_members(
                    event.organizer_id, event.organization_id, event.channel_id, add
                )
            if remove:
                await chat_ops.remove_members(
                    event.organizer_id, event.organization_id, event.channel_id, remove
                )
        except Exception:
            logger.opt(exception=True).warning(
                "auto-created meeting room member sync failed",
                event_id=str(event.id),
                channel_id=str(event.channel_id),
            )


class CategoryOperations:
    """Category CRUD (no permission system; org-wide)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        color: str,
        icon: str | None = None,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        result = await self.session.execute(
            select(func.max(Category.sort_order)).where(Category.organization_id == organization_id)
        )
        max_order = result.scalar() or 0

        category = Category(
            organization_id=organization_id,
            name=name,
            color=color,
            icon=icon,
            is_default=False,
            sort_order=max_order + 1,
        )
        self.session.add(category)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def get_by_id(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        result = await self.session.execute(
            select(Category).where(
                and_(
                    Category.id == category_id,
                    Category.organization_id == organization_id,
                )
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("Category", category_id)
        return category

    async def update(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
        name: str | None = None,
        color: str | None = None,
        icon: str | None = None,
        sort_order: int | None = None,
    ) -> Category:
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        if name is not None:
            category.name = name
        if color is not None:
            category.color = color
        if icon is not None:
            category.icon = icon
        if sort_order is not None:
            category.sort_order = sort_order

        category.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(category)
        return category

    async def delete(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
    ) -> bool:
        """Delete a category; default categories cannot be deleted."""
        await self._verify_org_membership(user_id, organization_id)

        category = await self.get_by_id(user_id, category_id, organization_id)

        if category.is_default:
            raise PermissionDeniedError("delete", "default category")

        await self.session.delete(category)
        await self.session.commit()
        return True

    async def list_categories(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        await self._verify_org_membership(user_id, organization_id)
        return await queries.get_categories(self.session, organization_id)

    async def ensure_defaults(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Category]:
        """Ensure the org has default categories."""
        await self._verify_org_membership(user_id, organization_id)
        return await queries.ensure_default_categories(self.session, organization_id)


class EventTemplateOperations:
    """EventTemplate CRUD. Org-scoped; not indexed for search."""

    def __init__(self, session: AsyncSession) -> None:
        from uniffy.core.auth.permissions.queries import ContentAccessQuery

        self.session = session
        self.access_query = ContentAccessQuery(session)

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        if await get_active_membership(self.session, user_id, organization_id) is None:
            raise PermissionDeniedError("access", "organization")

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        description: str = "",
        duration_minutes: int = 30,
        location: str = "",
        meeting_url: str | None = None,
        category_id: UUID | None = None,
        tags: list[str] | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> EventTemplate:
        await self._verify_org_membership(user_id, organization_id)

        access_mode, baseline_role = await resolve_access_policy(
            self.session,
            organization_id,
            ContentType.CALENDAR_EVENT,
            access_mode,
            baseline_role,
        )

        template = EventTemplate(
            organization_id=organization_id,
            title=title,
            description=description,
            duration_minutes=duration_minutes,
            location=location,
            meeting_url=meeting_url,
            category_id=category_id,
            tags=tags or [],
            access_mode=access_mode,
            baseline_role=baseline_role,
            created_by=user_id,
        )
        self.session.add(template)
        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def get_by_id(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> EventTemplate:
        """Get a template by ID, enforcing access policy."""

        await self._verify_org_membership(user_id, organization_id)

        query = select(EventTemplate).where(
            and_(
                EventTemplate.id == template_id,
                EventTemplate.organization_id == organization_id,
            )
        )
        result = await self.session.execute(query)
        template = result.scalar_one_or_none()

        if not template:
            raise NotFoundError("EventTemplate", template_id)

        from uniffy.core.auth.permissions import resolve_effective_policy
        from uniffy.core.auth.permissions.defaults import resolve_content_defaults

        default_mode, default_baseline = await resolve_content_defaults(
            self.session,
            organization_id,
            ContentType.CALENDAR_EVENT,
        )
        effective_mode, _ = resolve_effective_policy(
            template.access_mode,
            template.baseline_role,
            default_mode,
            default_baseline,
        )
        if effective_mode == AccessMode.OWNER_ONLY and template.created_by != user_id:
            raise PermissionDeniedError("read", "event template")

        return template

    async def update(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        **kwargs,
    ) -> EventTemplate:
        """Update a template (creator only)."""
        template = await self.get_by_id(template_id, organization_id, user_id)

        if template.created_by != user_id:
            raise PermissionDeniedError("update", "event template")

        for key, value in kwargs.items():
            if hasattr(template, key):
                setattr(template, key, value)

        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def delete(
        self,
        template_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Delete a template (creator only)."""
        template = await self.get_by_id(template_id, organization_id, user_id)

        if template.created_by != user_id:
            raise PermissionDeniedError("delete", "event template")

        await self.session.delete(template)
        await self.session.commit()
        return True

    async def list(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> list[EventTemplate]:
        """List templates visible to the user."""
        await self._verify_org_membership(user_id, organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id_column=EventTemplate.id,
            owner_id_column=EventTemplate.created_by,
            access_mode_column=EventTemplate.access_mode,
            baseline_role_column=EventTemplate.baseline_role,
        )
        query = select(EventTemplate).where(
            EventTemplate.organization_id == organization_id,
            access_filter,
        )

        result = await self.session.execute(query)
        return list(result.scalars().all())


async def _load_calendar_event(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> CalendarEvent | None:
    result = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.id == content_id,
            CalendarEvent.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.CALENDAR_EVENT, _load_calendar_event)
