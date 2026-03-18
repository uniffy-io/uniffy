"""Proto <-> domain converters for calendar domain."""

from datetime import datetime

from uniffy.core.converters.proto import datetime_to_timestamp, timestamp_to_datetime
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.shared import (
    AttendeeRole,
    AttendeeStatus,
    RecurrencePattern,
    ResourceType,
    VisibilityScope,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    Attendee as ProtoAttendee,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    AttendeeRole as ProtoAttendeeRole,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    AttendeeStatus as ProtoAttendeeStatus,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    CalendarEvent as ProtoCalendarEvent,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    Category as ProtoCategory,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    DayOfWeek as ProtoDayOfWeek,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    EventTemplate as ProtoEventTemplate,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    LinkedResource as ProtoLinkedResource,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    RecurrenceConfig as ProtoRecurrenceConfig,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    RecurrenceEditScope as ProtoRecurrenceEditScope,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    RecurrencePattern as ProtoRecurrencePattern,
)
from uniffy.gen.cal.v1.calendar_pb2 import (
    ResourceType as ProtoResourceType,
)
from uniffy.gen.common.v1.common_pb2 import (
    VisibilityScope as ProtoVisibilityScope,
)

VISIBILITY_TO_PROTO = {
    VisibilityScope.PRIVATE: ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    VisibilityScope.GROUP: ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP,
    VisibilityScope.ORGANIZATION: ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION,
    VisibilityScope.PUBLIC: ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC,
}

VISIBILITY_FROM_PROTO = {
    ProtoVisibilityScope.VISIBILITY_SCOPE_UNSPECIFIED: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE: VisibilityScope.PRIVATE,
    ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP: VisibilityScope.GROUP,
    ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope.ORGANIZATION,
    ProtoVisibilityScope.VISIBILITY_SCOPE_PUBLIC: VisibilityScope.PUBLIC,
}

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

RESOURCE_TYPE_FROM_PROTO = {
    ProtoResourceType.RESOURCE_TYPE_UNSPECIFIED: ResourceType.NOTE,
    ProtoResourceType.RESOURCE_TYPE_NOTE: ResourceType.NOTE,
    ProtoResourceType.RESOURCE_TYPE_FILE: ResourceType.FILE,
    ProtoResourceType.RESOURCE_TYPE_CHAT: ResourceType.CHAT,
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

RECURRENCE_EDIT_SCOPE_FROM_PROTO = {
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_UNSPECIFIED: "all_events",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_THIS_EVENT: "this_event",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_ALL_EVENTS: "all_events",
    ProtoRecurrenceEditScope.RECURRENCE_EDIT_SCOPE_THIS_AND_FOLLOWING: "this_and_following",
}


def visibility_from_proto(proto_visibility: ProtoVisibilityScope) -> VisibilityScope:
    """Convert proto VisibilityScope to model."""
    return VISIBILITY_FROM_PROTO.get(proto_visibility, VisibilityScope.PRIVATE)


def recurrence_from_proto(proto_recurrence: ProtoRecurrencePattern) -> RecurrencePattern:
    """Convert proto RecurrencePattern to model."""
    return RECURRENCE_FROM_PROTO.get(proto_recurrence, RecurrencePattern.NONE)


def attendee_status_from_proto(proto_status: ProtoAttendeeStatus) -> AttendeeStatus:
    """Convert proto AttendeeStatus to model."""
    return ATTENDEE_STATUS_FROM_PROTO.get(proto_status, AttendeeStatus.PENDING)


def attendee_role_from_proto(proto_role: ProtoAttendeeRole) -> AttendeeRole:
    """Convert proto AttendeeRole to model."""
    return ATTENDEE_ROLE_FROM_PROTO.get(proto_role, AttendeeRole.REQUIRED)


def resource_type_from_proto(proto_type: ProtoResourceType) -> ResourceType:
    """Convert proto ResourceType to model."""
    return RESOURCE_TYPE_FROM_PROTO.get(proto_type, ResourceType.NOTE)


def recurrence_edit_scope_from_proto(proto_scope: ProtoRecurrenceEditScope.ValueType) -> str:
    """Convert proto RecurrenceEditScope to string."""
    return RECURRENCE_EDIT_SCOPE_FROM_PROTO.get(proto_scope, "all_events")


def event_to_proto(
    event: CalendarEvent,
    attendees: list[tuple[EventAttendee, dict]] | None = None,
) -> ProtoCalendarEvent:
    """
    Convert CalendarEvent model to proto CalendarEvent.

    Parameters
    ----------
    event : CalendarEvent
        Event model instance.
    attendees : list[tuple[EventAttendee, dict]] | None
        List of (EventAttendee, user_info) tuples for attendee details.

    Returns
    -------
    ProtoCalendarEvent
        Proto message.

    """
    proto_visibility = VISIBILITY_TO_PROTO.get(
        event.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )
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
        visibility=proto_visibility,
        is_deleted=event.is_deleted,
        tags=event.tags or [],
        outgoing_references=event.outgoing_references or [],
        created_at=datetime_to_timestamp(event.created_at),
        updated_at=datetime_to_timestamp(event.updated_at),
    )

    # Set recurring flag
    proto_event.is_recurring = event.recurrence_pattern != RecurrencePattern.NONE

    # Set recurrence_id if this is an override instance
    if event.recurrence_id:
        proto_event.recurrence_id = str(event.recurrence_id)

    # Set occurrence_date if present (set dynamically on expanded instances)
    occurrence_date = getattr(event, "_occurrence_date", None)
    if occurrence_date:
        proto_event.occurrence_date = occurrence_date

    if event.reminders:
        proto_event.reminders.extend(event.reminders)

    if event.meeting_url:
        proto_event.meeting_url = event.meeting_url

    if event.deleted_at:
        proto_event.deleted_at.CopyFrom(datetime_to_timestamp(event.deleted_at))

    # Add linked resources
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

    # Add recurrence config
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

    # Add attendees
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
            proto_event.attendees.append(proto_attendee)

    return proto_event


def category_to_proto(category: Category) -> ProtoCategory:
    """
    Convert Category model to proto Category.

    Parameters
    ----------
    category : Category
        Category model instance.

    Returns
    -------
    ProtoCategory
        Proto message.

    """
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
    """
    Convert proto RecurrenceConfig to dict for storage.

    Parameters
    ----------
    proto_config : ProtoRecurrenceConfig
        Proto recurrence config.

    Returns
    -------
    dict
        Recurrence config dict for JSONB storage.

    """
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


def template_to_proto(template: EventTemplate) -> ProtoEventTemplate:
    """Convert EventTemplate model to proto."""
    proto_visibility = VISIBILITY_TO_PROTO.get(
        template.visibility,
        ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    )

    return ProtoEventTemplate(
        id=str(template.id),
        organization_id=str(template.organization_id),
        title=template.title,
        description=template.description,
        duration_minutes=template.duration_minutes,
        location=template.location,
        meeting_url=template.meeting_url,
        category_id=str(template.category_id) if template.category_id else None,
        tags=template.tags or [],
        visibility=proto_visibility,
        created_by=str(template.created_by),
        created_at=datetime_to_timestamp(template.created_at),
        updated_at=datetime_to_timestamp(template.updated_at),
    )
