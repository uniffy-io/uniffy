"""Proto <-> domain converters for the calendar domain."""

from datetime import datetime

from uniffy_proto.cal.v1.calendar_pb2 import (
    Attendee as ProtoAttendee,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    AttendeeRole as ProtoAttendeeRole,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    AttendeeStatus as ProtoAttendeeStatus,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    CalendarEvent as ProtoCalendarEvent,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    Category as ProtoCategory,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    DayOfWeek as ProtoDayOfWeek,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    EventActivity as ProtoEventActivity,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    EventActivityAction as ProtoEventActivityAction,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    EventTemplate as ProtoEventTemplate,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    LinkedResource as ProtoLinkedResource,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    RecurrenceConfig as ProtoRecurrenceConfig,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    RecurrenceEditScope as ProtoRecurrenceEditScope,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    RecurrencePattern as ProtoRecurrencePattern,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
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
    RecurrencePattern,
    ResourceType,
)
from uniffy.domains.tags.converters import tag_to_proto

# Domain-local enum maps. ``access_mode`` and ``content_role`` are shared
# across every domain so they live in ``core.converters.common_proto``.
RECURRENCE_TO_PROTO = {
    RecurrencePattern.NONE: ProtoRecurrencePattern.RECURRENCE_PATTERN_NONE,
    RecurrencePattern.DAILY: ProtoRecurrencePattern.RECURRENCE_PATTERN_DAILY,
    RecurrencePattern.WEEKLY: ProtoRecurrencePattern.RECURRENCE_PATTERN_WEEKLY,
    RecurrencePattern.BIWEEKLY: ProtoRecurrencePattern.RECURRENCE_PATTERN_BIWEEKLY,
    RecurrencePattern.MONTHLY: ProtoRecurrencePattern.RECURRENCE_PATTERN_MONTHLY,
    RecurrencePattern.YEARLY: ProtoRecurrencePattern.RECURRENCE_PATTERN_YEARLY,
}

RECURRENCE_FROM_PROTO = {
    ProtoRecurrencePattern.RECURRENCE_PATTERN_UNSPECIFIED: RecurrencePattern.NONE,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_NONE: RecurrencePattern.NONE,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_DAILY: RecurrencePattern.DAILY,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_WEEKLY: RecurrencePattern.WEEKLY,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_BIWEEKLY: RecurrencePattern.BIWEEKLY,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_MONTHLY: RecurrencePattern.MONTHLY,
    ProtoRecurrencePattern.RECURRENCE_PATTERN_YEARLY: RecurrencePattern.YEARLY,
}

ATTENDEE_STATUS_TO_PROTO = {
    AttendeeStatus.PENDING: ProtoAttendeeStatus.ATTENDEE_STATUS_PENDING,
    AttendeeStatus.ACCEPTED: ProtoAttendeeStatus.ATTENDEE_STATUS_ACCEPTED,
    AttendeeStatus.TENTATIVE: ProtoAttendeeStatus.ATTENDEE_STATUS_TENTATIVE,
    AttendeeStatus.DECLINED: ProtoAttendeeStatus.ATTENDEE_STATUS_DECLINED,
}

ATTENDEE_STATUS_FROM_PROTO = {
    ProtoAttendeeStatus.ATTENDEE_STATUS_UNSPECIFIED: AttendeeStatus.PENDING,
    ProtoAttendeeStatus.ATTENDEE_STATUS_PENDING: AttendeeStatus.PENDING,
    ProtoAttendeeStatus.ATTENDEE_STATUS_ACCEPTED: AttendeeStatus.ACCEPTED,
    ProtoAttendeeStatus.ATTENDEE_STATUS_TENTATIVE: AttendeeStatus.TENTATIVE,
    ProtoAttendeeStatus.ATTENDEE_STATUS_DECLINED: AttendeeStatus.DECLINED,
}

ATTENDEE_ROLE_TO_PROTO = {
    AttendeeRole.ORGANIZER: ProtoAttendeeRole.ATTENDEE_ROLE_ORGANIZER,
    AttendeeRole.REQUIRED: ProtoAttendeeRole.ATTENDEE_ROLE_REQUIRED,
    AttendeeRole.OPTIONAL: ProtoAttendeeRole.ATTENDEE_ROLE_OPTIONAL,
}

ATTENDEE_ROLE_FROM_PROTO = {
    ProtoAttendeeRole.ATTENDEE_ROLE_UNSPECIFIED: AttendeeRole.REQUIRED,
    ProtoAttendeeRole.ATTENDEE_ROLE_ORGANIZER: AttendeeRole.ORGANIZER,
    ProtoAttendeeRole.ATTENDEE_ROLE_REQUIRED: AttendeeRole.REQUIRED,
    ProtoAttendeeRole.ATTENDEE_ROLE_OPTIONAL: AttendeeRole.OPTIONAL,
}

RESOURCE_TYPE_TO_PROTO = {
    ResourceType.NOTE: ProtoResourceType.RESOURCE_TYPE_NOTE,
    ResourceType.FILE: ProtoResourceType.RESOURCE_TYPE_FILE,
    ResourceType.CHAT: ProtoResourceType.RESOURCE_TYPE_CHAT,
}

DAY_OF_WEEK_MAP = {
    "MONDAY": ProtoDayOfWeek.DAY_OF_WEEK_MONDAY,
    "TUESDAY": ProtoDayOfWeek.DAY_OF_WEEK_TUESDAY,
    "WEDNESDAY": ProtoDayOfWeek.DAY_OF_WEEK_WEDNESDAY,
    "THURSDAY": ProtoDayOfWeek.DAY_OF_WEEK_THURSDAY,
    "FRIDAY": ProtoDayOfWeek.DAY_OF_WEEK_FRIDAY,
    "SATURDAY": ProtoDayOfWeek.DAY_OF_WEEK_SATURDAY,
    "SUNDAY": ProtoDayOfWeek.DAY_OF_WEEK_SUNDAY,
}

DAY_OF_WEEK_FROM_PROTO = {v: k for k, v in DAY_OF_WEEK_MAP.items()}

ACTIVITY_ACTION_TO_PROTO = {
    "created": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_CREATED,
    "title_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_TITLE_CHANGED,
    "schedule_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_SCHEDULE_CHANGED,
    "location_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_LOCATION_CHANGED,
    "meeting_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_MEETING_CHANGED,
    "description_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_DESCRIPTION_CHANGED,
    "category_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_CATEGORY_CHANGED,
    "calendar_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_CALENDAR_CHANGED,
    "recurrence_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_RECURRENCE_CHANGED,
    "reminders_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_REMINDERS_CHANGED,
    "attendees_added": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_ATTENDEES_ADDED,
    "attendees_removed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_ATTENDEES_REMOVED,
    "response_changed": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_RESPONSE_CHANGED,
    "field_updated": ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_FIELD_UPDATED,
}

RECURRENCE_EDIT_SCOPE_FROM_PROTO = {
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_UNSPECIFIED: "all_events",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_THIS_EVENT: "this_event",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_ALL_EVENTS: "all_events",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_THIS_AND_FOLLOWING: "this_and_following",
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


def recurrence_edit_scope_from_proto(proto_scope: ProtoRecurrenceEditScope.ValueType) -> str:
    """Convert proto RecurrenceEditScope to a string code."""
    return RECURRENCE_EDIT_SCOPE_FROM_PROTO.get(proto_scope, "all_events")


def activity_to_proto(activity: EventActivity) -> ProtoEventActivity:
    proto = ProtoEventActivity(
        id=str(activity.id),
        event_id=str(activity.event_id),
        actor_id=str(activity.actor_id),
        action=ACTIVITY_ACTION_TO_PROTO.get(
            activity.action,
            ProtoEventActivityAction.EVENT_ACTIVITY_ACTION_UNSPECIFIED,
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
) -> ProtoCalendarEvent:
    """Convert a ``CalendarEvent`` row to its proto representation.

    Recurring instances share their master's tag set, so the handler resolves
    the master URN before calling. No channel-name hydration: only
    ``channel_id`` and ``channel_auto_created`` ride along and the frontend
    resolves the channel name, which keeps private channel names from leaking
    on list paths.
    """
    proto_recurrence = RECURRENCE_TO_PROTO.get(
        event.recurrence_pattern,
        ProtoRecurrencePattern.RECURRENCE_PATTERN_NONE,
    )

    proto_event = ProtoCalendarEvent(
        id=str(event.id),
        organization_id=str(event.organization_id),
        title=event.title,
        description=event.description,
        start_time=datetime_to_timestamp(event.start_time),
        end_time=datetime_to_timestamp(event.end_time),
        is_all_day=event.is_all_day,
        timezone=event.timezone,
        location=event.location,
        calendar_id=str(event.calendar_id),
        category_id=str(event.category_id) if event.category_id else "",
        organizer_id=str(event.organizer_id),
        is_focus_time=event.is_focus_time,
        is_deleted=event.is_deleted,
        channel_auto_created=event.channel_auto_created,
        tags=[tag_to_proto(t) for t in tags] if tags else [],
        outgoing_references=event.outgoing_references or [],
        created_at=datetime_to_timestamp(event.created_at),
        updated_at=datetime_to_timestamp(event.updated_at),
    )

    if user_role is not None:
        proto_event.user_role = content_role_to_proto(user_role)

    proto_event.is_recurring = event.recurrence_pattern != RecurrencePattern.NONE

    if event.recurrence_id:
        proto_event.recurrence_id = str(event.recurrence_id)

    occurrence_date = getattr(event, "_occurrence_date", None)
    if occurrence_date:
        proto_event.occurrence_date = occurrence_date

    if event.reminders:
        proto_event.reminders.extend(event.reminders)

    if event.meeting_url:
        proto_event.meeting_url = event.meeting_url

    if event.channel_id:
        proto_event.channel_id = str(event.channel_id)

    if event.deleted_at:
        proto_event.deleted_at.CopyFrom(datetime_to_timestamp(event.deleted_at))

    if event.linked_resources:
        for resource in event.linked_resources:
            proto_resource = ProtoLinkedResource(
                id=resource.get("id", ""),
                type=RESOURCE_TYPE_TO_PROTO.get(
                    ResourceType(resource.get("type", "NOTE")),
                    ProtoResourceType.RESOURCE_TYPE_NOTE,
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
            proto_recurrence_config.end_date.CopyFrom(datetime_to_timestamp(end_dt))
        if config.get("max_occurrences"):
            proto_recurrence_config.max_occurrences = config["max_occurrences"]
        proto_event.recurrence.CopyFrom(proto_recurrence_config)

    if attendees:
        for attendee, user_info in attendees:
            proto_attendee = ProtoAttendee(
                id=str(attendee.user_id),
                name=user_info.get("name", ""),
                email=user_info.get("email", ""),
                initials=user_info.get("initials", ""),
                status=ATTENDEE_STATUS_TO_PROTO.get(
                    attendee.status,
                    ProtoAttendeeStatus.ATTENDEE_STATUS_PENDING,
                ),
                role=ATTENDEE_ROLE_TO_PROTO.get(
                    attendee.role,
                    ProtoAttendeeRole.ATTENDEE_ROLE_REQUIRED,
                ),
            )
            if user_info.get("avatar_url"):
                proto_attendee.avatar_url = user_info["avatar_url"]
            if user_info.get("timezone"):
                proto_attendee.timezone = user_info["timezone"]
            if attendee.invited_via_group_id:
                proto_attendee.invited_via_group_id = str(attendee.invited_via_group_id)
            proto_event.attendees.append(proto_attendee)

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

    if proto_config.HasField("day_of_month"):
        config["day_of_month"] = proto_config.day_of_month

    if proto_config.HasField("end_date"):
        config["end_date"] = timestamp_to_datetime(proto_config.end_date).isoformat()

    if proto_config.HasField("max_occurrences"):
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
