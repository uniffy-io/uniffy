from uniffy_proto.cal.v1.calendar_pb import Calendar as ProtoCalendar
from uniffy_proto.cal.v1.calendar_pb import CalendarListSection as ProtoCalendarListSection
from uniffy_proto.cal.v1.calendar_pb import CalendarSubscription as ProtoCalendarSubscription
from uniffy_proto.cal.v1.calendar_pb import CalendarType as ProtoCalendarType
from uniffy_proto.cal.v1.calendar_pb import ConnectedCalendarSummary

from uniffy.core.converters.common_proto import access_mode_to_proto, content_role_to_proto
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.types import AccessMode, CalendarType, ContentRole
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarListing, CalendarSection

CALENDAR_TYPE_TO_PROTO: dict[CalendarType, ProtoCalendarType] = {
    CalendarType.PERSONAL: ProtoCalendarType.PERSONAL,
    CalendarType.WORK: ProtoCalendarType.WORK,
    CalendarType.TEAM: ProtoCalendarType.TEAM,
    CalendarType.SHARED: ProtoCalendarType.SHARED,
    CalendarType.SUBSCRIBED: ProtoCalendarType.SUBSCRIBED,
    CalendarType.CONNECTED: ProtoCalendarType.CONNECTED,
}
CALENDAR_TYPE_FROM_PROTO = {v: k for k, v in CALENDAR_TYPE_TO_PROTO.items()}

_SECTION_TO_PROTO: dict[CalendarSection, ProtoCalendarListSection] = {
    CalendarSection.MINE: ProtoCalendarListSection.MINE,
    CalendarSection.SHARED: ProtoCalendarListSection.SHARED,
    CalendarSection.ORGANIZATION: ProtoCalendarListSection.ORGANIZATION,
    CalendarSection.SUBSCRIBED: ProtoCalendarListSection.SUBSCRIBED,
    CalendarSection.CONNECTED: ProtoCalendarListSection.CONNECTED,
}


def calendar_type_from_proto(value: ProtoCalendarType) -> CalendarType:
    return CALENDAR_TYPE_FROM_PROTO.get(value, CalendarType.PERSONAL)


def calendar_to_proto(
    listing: CalendarListing,
    user_role: ContentRole | None,
    owner_name: str = "",
    subscription: ProtoCalendarSubscription | None = None,
    *,
    read_only: bool | None = None,
    connection: ConnectedCalendarSummary | None = None,
) -> ProtoCalendar:
    calendar = listing.calendar
    message = ProtoCalendar(
        id=str(calendar.id),
        organization_id=str(calendar.organization_id),
        owner_id=str(calendar.owner_id),
        owner_name=owner_name,
        name=calendar.name,
        description=calendar.description,
        color=calendar.color,
        calendar_type=CALENDAR_TYPE_TO_PROTO[calendar.calendar_type],
        is_default=calendar.is_default,
        access_mode=access_mode_to_proto(calendar.access_mode or AccessMode.OWNER_ONLY),
        is_hidden=listing.is_hidden,
        section=_SECTION_TO_PROTO[listing.section],
        is_read_only=(
            calendar.calendar_type == CalendarType.SUBSCRIBED if read_only is None else read_only
        ),
        created_at=datetime_to_timestamp(calendar.created_at),
        updated_at=datetime_to_timestamp(calendar.updated_at),
    )
    if calendar.baseline_role is not None:
        message.baseline_role = content_role_to_proto(calendar.baseline_role)
    if user_role is not None:
        message.user_role = content_role_to_proto(user_role)
    if subscription is not None:
        message.subscription = subscription
    if connection is not None:
        message.connection = connection
    return message
