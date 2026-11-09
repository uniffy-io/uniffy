"""Calendar models for the calendar feature."""

from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarConnectionAttempt,
    ConnectedCalendar,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.member_settings import CalendarMemberSettings
from uniffy.core.models.calendar.participant import CalendarEventParticipant
from uniffy.core.models.calendar.provider_push import CalendarProviderPush
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.search_acl_refresh import CalendarSearchAclRefresh
from uniffy.core.models.calendar.subscription import CalendarSubscription
from uniffy.core.models.calendar.template import EventTemplate

__all__ = [
    "Calendar",
    "CalendarConnection",
    "CalendarConnectionAttempt",
    "CalendarEvent",
    "CalendarEventLink",
    "CalendarEventParticipant",
    "CalendarProviderPush",
    "Category",
    "ConnectedCalendar",
    "CalendarFeedToken",
    "CalendarMemberSettings",
    "CalendarSearchAclRefresh",
    "CalendarSubscription",
    "EventActivity",
    "EventAttendee",
    "EventReminder",
    "EventTemplate",
    "RecurrenceException",
]
