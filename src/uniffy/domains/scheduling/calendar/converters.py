"""Proto <-> domain converters for the calendar domain."""

from datetime import UTC, datetime

from uniffy_proto.cal.v1.calendar_pb import (
    Attendee as ProtoAttendee,
)
from uniffy_proto.cal.v1.calendar_pb import (
    AttendeeRole as ProtoAttendeeRole,
)
from uniffy_proto.cal.v1.calendar_pb import (
    AttendeeStatus as ProtoAttendeeStatus,
)
from uniffy_proto.cal.v1.calendar_pb import (
    CalendarEvent as ProtoCalendarEvent,
)
from uniffy_proto.cal.v1.calendar_pb import (
    Category as ProtoCategory,
)
from uniffy_proto.cal.v1.calendar_pb import (
    DayOfWeek as ProtoDayOfWeek,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventActivity as ProtoEventActivity,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventActivityAction as ProtoEventActivityAction,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventStatus as ProtoEventStatus,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventTemplate as ProtoEventTemplate,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventTransparency as ProtoEventTransparency,
)
from uniffy_proto.cal.v1.calendar_pb import (
    EventVisibility as ProtoEventVisibility,
)
from uniffy_proto.cal.v1.calendar_pb import (
    LinkedResource as ProtoLinkedResource,
)
from uniffy_proto.cal.v1.calendar_pb import (
    RecurrenceConfig as ProtoRecurrenceConfig,
)
from uniffy_proto.cal.v1.calendar_pb import (
    RecurrenceEditScope as ProtoRecurrenceEditScope,
)
from uniffy_proto.cal.v1.calendar_pb import (
    RecurrencePattern as ProtoRecurrencePattern,
)
from uniffy_proto.cal.v1.calendar_pb import (
    ResourceType as ProtoResourceType,
)

from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.converters.proto import datetime_to_timestamp, timestamp_to_datetime
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import (
    AccessMode,
    AttendeeRole,
    AttendeeStatus,
    ContentRole,
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrenceEditScope,
    RecurrencePattern,
    ResourceType,
)
from uniffy.domains.tags.converters import tag_to_proto

# Domain-local enum maps. ``access_mode`` and ``content_role`` are shared
# across every domain so they live in ``core.converters.common_proto``.
RECURRENCE_TO_PROTO = {
    RecurrencePattern.NONE: ProtoRecurrencePattern.NONE,
    RecurrencePattern.DAILY: ProtoRecurrencePattern.DAILY,
    RecurrencePattern.WEEKLY: ProtoRecurrencePattern.WEEKLY,
    RecurrencePattern.BIWEEKLY: ProtoRecurrencePattern.BIWEEKLY,
    RecurrencePattern.MONTHLY: ProtoRecurrencePattern.MONTHLY,
    RecurrencePattern.YEARLY: ProtoRecurrencePattern.YEARLY,
}

RECURRENCE_FROM_PROTO = {
    ProtoRecurrencePattern.UNSPECIFIED: RecurrencePattern.NONE,
    ProtoRecurrencePattern.NONE: RecurrencePattern.NONE,
    ProtoRecurrencePattern.DAILY: RecurrencePattern.DAILY,
    ProtoRecurrencePattern.WEEKLY: RecurrencePattern.WEEKLY,
    ProtoRecurrencePattern.BIWEEKLY: RecurrencePattern.BIWEEKLY,
    ProtoRecurrencePattern.MONTHLY: RecurrencePattern.MONTHLY,
    ProtoRecurrencePattern.YEARLY: RecurrencePattern.YEARLY,
}

EVENT_STATUS_TO_PROTO = {
    EventStatus.CONFIRMED: ProtoEventStatus.CONFIRMED,
    EventStatus.TENTATIVE: ProtoEventStatus.TENTATIVE,
    EventStatus.CANCELLED: ProtoEventStatus.CANCELLED,
}

EVENT_STATUS_FROM_PROTO = {
    ProtoEventStatus.UNSPECIFIED: EventStatus.CONFIRMED,
    ProtoEventStatus.CONFIRMED: EventStatus.CONFIRMED,
    ProtoEventStatus.TENTATIVE: EventStatus.TENTATIVE,
    ProtoEventStatus.CANCELLED: EventStatus.CANCELLED,
}

EVENT_VISIBILITY_TO_PROTO = {
    EventVisibility.STANDARD: ProtoEventVisibility.STANDARD,
    EventVisibility.PRIVATE: ProtoEventVisibility.PRIVATE,
}

EVENT_VISIBILITY_FROM_PROTO = {
    ProtoEventVisibility.UNSPECIFIED: EventVisibility.STANDARD,
    ProtoEventVisibility.STANDARD: EventVisibility.STANDARD,
    ProtoEventVisibility.PRIVATE: EventVisibility.PRIVATE,
}

EVENT_TRANSPARENCY_TO_PROTO = {
    EventTransparency.OPAQUE: ProtoEventTransparency.OPAQUE,
    EventTransparency.TRANSPARENT: ProtoEventTransparency.TRANSPARENT,
}

EVENT_TRANSPARENCY_FROM_PROTO = {
    ProtoEventTransparency.OPAQUE: EventTransparency.OPAQUE,
    ProtoEventTransparency.TRANSPARENT: EventTransparency.TRANSPARENT,
}

ATTENDEE_STATUS_TO_PROTO = {
    AttendeeStatus.PENDING: ProtoAttendeeStatus.PENDING,
    AttendeeStatus.ACCEPTED: ProtoAttendeeStatus.ACCEPTED,
    AttendeeStatus.TENTATIVE: ProtoAttendeeStatus.TENTATIVE,
    AttendeeStatus.DECLINED: ProtoAttendeeStatus.DECLINED,
}

ATTENDEE_STATUS_FROM_PROTO = {
    ProtoAttendeeStatus.UNSPECIFIED: AttendeeStatus.PENDING,
    ProtoAttendeeStatus.PENDING: AttendeeStatus.PENDING,
    ProtoAttendeeStatus.ACCEPTED: AttendeeStatus.ACCEPTED,
    ProtoAttendeeStatus.TENTATIVE: AttendeeStatus.TENTATIVE,
    ProtoAttendeeStatus.DECLINED: AttendeeStatus.DECLINED,
}

ATTENDEE_ROLE_TO_PROTO = {
    AttendeeRole.ORGANIZER: ProtoAttendeeRole.ORGANIZER,
    AttendeeRole.REQUIRED: ProtoAttendeeRole.REQUIRED,
    AttendeeRole.OPTIONAL: ProtoAttendeeRole.OPTIONAL,
}

ATTENDEE_ROLE_FROM_PROTO = {
    ProtoAttendeeRole.UNSPECIFIED: AttendeeRole.REQUIRED,
    ProtoAttendeeRole.ORGANIZER: AttendeeRole.ORGANIZER,
    ProtoAttendeeRole.REQUIRED: AttendeeRole.REQUIRED,
    ProtoAttendeeRole.OPTIONAL: AttendeeRole.OPTIONAL,
}

RESOURCE_TYPE_TO_PROTO = {
    ResourceType.NOTE: ProtoResourceType.NOTE,
    ResourceType.FILE: ProtoResourceType.FILE,
    ResourceType.CHAT: ProtoResourceType.CHAT,
}

DAY_OF_WEEK_MAP = {
    "MONDAY": ProtoDayOfWeek.MONDAY,
    "TUESDAY": ProtoDayOfWeek.TUESDAY,
    "WEDNESDAY": ProtoDayOfWeek.WEDNESDAY,
    "THURSDAY": ProtoDayOfWeek.THURSDAY,
    "FRIDAY": ProtoDayOfWeek.FRIDAY,
    "SATURDAY": ProtoDayOfWeek.SATURDAY,
    "SUNDAY": ProtoDayOfWeek.SUNDAY,
}

DAY_OF_WEEK_FROM_PROTO = {v: k for k, v in DAY_OF_WEEK_MAP.items()}

ACTIVITY_ACTION_TO_PROTO = {
    "created": ProtoEventActivityAction.CREATED,
    "title_changed": ProtoEventActivityAction.TITLE_CHANGED,
    "schedule_changed": ProtoEventActivityAction.SCHEDULE_CHANGED,
    "location_changed": ProtoEventActivityAction.LOCATION_CHANGED,
    "meeting_changed": ProtoEventActivityAction.MEETING_CHANGED,
    "description_changed": ProtoEventActivityAction.DESCRIPTION_CHANGED,
    "category_changed": ProtoEventActivityAction.CATEGORY_CHANGED,
    "calendar_changed": ProtoEventActivityAction.CALENDAR_CHANGED,
    "recurrence_changed": ProtoEventActivityAction.RECURRENCE_CHANGED,
    "reminders_changed": ProtoEventActivityAction.REMINDERS_CHANGED,
    "attendees_added": ProtoEventActivityAction.ATTENDEES_ADDED,
    "attendees_removed": ProtoEventActivityAction.ATTENDEES_REMOVED,
    "response_changed": ProtoEventActivityAction.RESPONSE_CHANGED,
    "field_updated": ProtoEventActivityAction.FIELD_UPDATED,
}

RECURRENCE_EDIT_SCOPE_FROM_PROTO = {
    ProtoRecurrenceEditScope.UNSPECIFIED: RecurrenceEditScope.ALL_EVENTS,
    ProtoRecurrenceEditScope.THIS_EVENT: RecurrenceEditScope.THIS_EVENT,
    ProtoRecurrenceEditScope.ALL_EVENTS: RecurrenceEditScope.ALL_EVENTS,
    ProtoRecurrenceEditScope.THIS_AND_FOLLOWING: (RecurrenceEditScope.THIS_AND_FOLLOWING),
}


def recurrence_from_proto(proto_recurrence: ProtoRecurrencePattern) -> RecurrencePattern:
    """Convert proto RecurrencePattern to the domain enum."""
    return RECURRENCE_FROM_PROTO.get(proto_recurrence, RecurrencePattern.NONE)


def attendee_status_from_proto(proto_status: ProtoAttendeeStatus) -> AttendeeStatus:
    """Convert proto AttendeeStatus to the domain enum."""
    return ATTENDEE_STATUS_FROM_PROTO.get(proto_status, AttendeeStatus.PENDING)


def attendee_role_from_proto(proto_role: ProtoAttendeeRole) -> AttendeeRole:
    """Convert proto AttendeeRole to the domain enum."""
    return ATTENDEE_ROLE_FROM_PROTO.get(proto_role, AttendeeRole.REQUIRED)


def recurrence_edit_scope_from_proto(
    proto_scope: ProtoRecurrenceEditScope,
) -> RecurrenceEditScope:
    """Convert proto RecurrenceEditScope to its domain value."""
    return RECURRENCE_EDIT_SCOPE_FROM_PROTO.get(proto_scope, RecurrenceEditScope.ALL_EVENTS)


def event_status_from_proto(proto_status: ProtoEventStatus) -> EventStatus:
    return EVENT_STATUS_FROM_PROTO.get(proto_status, EventStatus.CONFIRMED)


def event_visibility_from_proto(proto_visibility: ProtoEventVisibility) -> EventVisibility:
    return EVENT_VISIBILITY_FROM_PROTO.get(proto_visibility, EventVisibility.STANDARD)


def event_transparency_from_proto(
    proto_transparency: ProtoEventTransparency,
) -> EventTransparency | None:
    """UNSPECIFIED maps to None so the operations layer can apply its own default."""
    return EVENT_TRANSPARENCY_FROM_PROTO.get(proto_transparency)


def activity_to_proto(activity: EventActivity) -> ProtoEventActivity:
    proto = ProtoEventActivity(
        id=str(activity.id),
        event_id=str(activity.event_id),
        actor_id=str(activity.actor_id),
        action=ACTIVITY_ACTION_TO_PROTO.get(
            activity.action,
            ProtoEventActivityAction.UNSPECIFIED,
        ),
        timestamp=datetime_to_timestamp(activity.timestamp),
    )

    if activity.field_id:
        proto.field_id = activity.field_id
    if activity.previous_value:
        proto.previous_value = activity.previous_value
    if activity.new_value:
        proto.new_value = activity.new_value
    return proto


def event_to_proto(
    event: CalendarEvent,
    attendees: list[tuple[EventAttendee, dict]] | None = None,
    *,
    tags: list[Tag] | None = None,
    room_id: str | None = None,
    room_name: str | None = None,
    room_location: str | None = None,
    room_capacity: int = 0,
    room_amenities: list[str] | None = None,
    user_role: ContentRole | None = None,
    details_hidden: bool = False,
) -> ProtoCalendarEvent:
    """Convert a ``CalendarEvent`` row to its proto representation.

    Recurring instances share their master's tag set, so the handler resolves
    the master URN before calling. No channel-name hydration: only
    ``channel_id`` and ``channel_auto_created`` ride along and the frontend
    resolves the channel name, which keeps private channel names from leaking
    on list paths.

    ``details_hidden`` is the private-event redaction: only the fields needed
    to render an honest busy block survive - times, all-day, timezone, status,
    transparency, out-of-office, and recurrence identity. Everything that
    reveals what the event is about is stripped server-side.
    """
    proto_recurrence = RECURRENCE_TO_PROTO.get(
        event.recurrence_pattern,
        ProtoRecurrencePattern.NONE,
    )

    proto_event = ProtoCalendarEvent(
        id=str(event.id),
        organization_id=str(event.organization_id),
        title="" if details_hidden else event.title,
        description="" if details_hidden else event.description,
        start_time=datetime_to_timestamp(event.start_time),
        end_time=datetime_to_timestamp(event.end_time),
        is_all_day=event.is_all_day,
        timezone=event.timezone,
        location="" if details_hidden else event.location,
        calendar_id=str(event.calendar_id),
        category_id=str(event.category_id) if event.category_id and not details_hidden else "",
        organizer_id=str(event.organizer_id),
        is_focus_time=event.is_focus_time,
        is_deleted=event.is_deleted,
        channel_auto_created=event.channel_auto_created and not details_hidden,
        tags=[tag_to_proto(t) for t in tags] if tags and not details_hidden else [],
        outgoing_references=(event.outgoing_references or []) if not details_hidden else [],
        created_at=datetime_to_timestamp(event.created_at),
        updated_at=datetime_to_timestamp(event.updated_at),
        status=EVENT_STATUS_TO_PROTO.get(event.status, ProtoEventStatus.CONFIRMED),
        visibility=EVENT_VISIBILITY_TO_PROTO.get(event.visibility, ProtoEventVisibility.STANDARD),
        transparency=EVENT_TRANSPARENCY_TO_PROTO.get(
            event.transparency, ProtoEventTransparency.OPAQUE
        ),
        is_out_of_office=event.is_out_of_office,
        details_hidden=details_hidden,
    )

    if user_role is not None:
        proto_event.user_role = content_role_to_proto(user_role)

    proto_event.is_recurring = event.recurrence_pattern != RecurrencePattern.NONE

    if event.recurrence_id:
        proto_event.recurrence_id = str(event.recurrence_id)

    occurrence_date = getattr(event, "_occurrence_date", None)
    if occurrence_date:
        proto_event.occurrence_date = occurrence_date

    if event.reminders and not details_hidden:
        proto_event.reminders.extend(event.reminders)

    if event.meeting_url and not details_hidden:
        proto_event.meeting_url = event.meeting_url

    if event.channel_id and not details_hidden:
        proto_event.channel_id = str(event.channel_id)

    if event.deleted_at:
        proto_event.deleted_at = datetime_to_timestamp(event.deleted_at)

    if event.linked_resources and not details_hidden:
        for resource in event.linked_resources:
            proto_resource = ProtoLinkedResource(
                id=resource.get("id", ""),
                type=RESOURCE_TYPE_TO_PROTO.get(
                    ResourceType(resource.get("type", "NOTE")),
                    ProtoResourceType.NOTE,
                ),
                name=resource.get("name", ""),
            )
            if resource.get("url"):
                proto_resource.url = resource["url"]
            proto_event.linked_resources.append(proto_resource)

    if event.recurrence_config:
        config = event.recurrence_config
        proto_recurrence_config = ProtoRecurrenceConfig(
            pattern=proto_recurrence,
            interval=config.get("interval", 1),
        )
        if config.get("days_of_week"):
            for day in config["days_of_week"]:
                if day in DAY_OF_WEEK_MAP:
                    proto_recurrence_config.days_of_week.append(DAY_OF_WEEK_MAP[day])
        if config.get("day_of_month"):
            proto_recurrence_config.day_of_month = config["day_of_month"]
        if config.get("end_date"):
            end_dt = config["end_date"]
            if isinstance(end_dt, str):
                end_dt = datetime.fromisoformat(end_dt)
            if isinstance(end_dt, datetime):
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=UTC)
            else:
                # JSONB may hold a bare date; date-only midnight is UTC by convention.
                end_dt = datetime(end_dt.year, end_dt.month, end_dt.day, tzinfo=UTC)
            proto_recurrence_config.end_date = datetime_to_timestamp(end_dt)
        if config.get("max_occurrences"):
            proto_recurrence_config.max_occurrences = config["max_occurrences"]
        proto_event.recurrence = proto_recurrence_config

    if attendees and not details_hidden:
        for attendee, user_info in attendees:
            proto_attendee = ProtoAttendee(
                id=str(attendee.user_id),
                name=user_info.get("name", ""),
                email=user_info.get("email", ""),
                initials=user_info.get("initials", ""),
                status=ATTENDEE_STATUS_TO_PROTO.get(
                    attendee.status,
                    ProtoAttendeeStatus.PENDING,
                ),
                role=ATTENDEE_ROLE_TO_PROTO.get(
                    attendee.role,
                    ProtoAttendeeRole.REQUIRED,
                ),
            )
            if user_info.get("avatar_url"):
                proto_attendee.avatar_url = user_info["avatar_url"]
            if user_info.get("timezone"):
                proto_attendee.timezone = user_info["timezone"]
            if attendee.invited_via_group_id:
                proto_attendee.invited_via_group_id = str(attendee.invited_via_group_id)
            proto_event.attendees.append(proto_attendee)

    if details_hidden:
        return proto_event

    if room_id:
        proto_event.room_id = room_id
    if room_name:
        proto_event.room_name = room_name
    if room_location:
        proto_event.room_location = room_location
    if room_capacity:
        proto_event.room_capacity = room_capacity
    if room_amenities:
        proto_event.room_amenities.extend(room_amenities)

    return proto_event


def category_to_proto(category: Category) -> ProtoCategory:
    """Convert a :class:`Category` row to its proto representation."""
    proto_category = ProtoCategory(
        id=str(category.id),
        organization_id=str(category.organization_id),
        name=category.name,
        color=category.color,
        is_default=category.is_default,
        sort_order=category.sort_order,
        created_at=datetime_to_timestamp(category.created_at),
        updated_at=datetime_to_timestamp(category.updated_at),
    )

    if category.icon:
        proto_category.icon = category.icon

    return proto_category


def recurrence_config_from_proto(proto_config: ProtoRecurrenceConfig) -> dict:
    """Convert a proto RecurrenceConfig to a JSONB-serializable dict."""
    config = {
        "pattern": RECURRENCE_FROM_PROTO.get(
            proto_config.pattern,
            RecurrencePattern.NONE,
        ).value,
        "interval": proto_config.interval or 1,
    }

    if proto_config.days_of_week:
        config["days_of_week"] = [
            DAY_OF_WEEK_FROM_PROTO.get(day, "MONDAY") for day in proto_config.days_of_week
        ]

    if proto_config.has_field("day_of_month"):
        config["day_of_month"] = proto_config.day_of_month

    if proto_config.has_field("end_date"):
        config["end_date"] = timestamp_to_datetime(proto_config.end_date).isoformat()

    if proto_config.has_field("max_occurrences"):
        config["max_occurrences"] = proto_config.max_occurrences

    return config


def template_to_proto(
    template: EventTemplate,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> ProtoEventTemplate:
    """Convert an :class:`EventTemplate` row to its proto representation."""
    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else template.access_mode
    )
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else template.baseline_role
    )
    proto = ProtoEventTemplate(
        id=str(template.id),
        organization_id=str(template.organization_id),
        title=template.title,
        description=template.description,
        duration_minutes=template.duration_minutes,
        location=template.location,
        meeting_url=template.meeting_url,
        category_id=str(template.category_id) if template.category_id else None,
        tags=template.tags or [],
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        created_by=str(template.created_by),
        created_at=datetime_to_timestamp(template.created_at),
        updated_at=datetime_to_timestamp(template.updated_at),
    )
    if resolved_baseline is not None:
        proto.baseline_role = content_role_to_proto(resolved_baseline)
    return proto
