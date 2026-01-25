"""Database models package."""

from uwos.core.models.calendar.attendee import EventAttendee
from uwos.core.models.calendar.calendar import Calendar
from uwos.core.models.calendar.category import Category
from uwos.core.models.calendar.event import CalendarEvent
from uwos.core.models.login.group import Group
from uwos.core.models.login.group_member import GroupMember, GroupRole
from uwos.core.models.login.organization import Organization
from uwos.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uwos.core.models.login.sso_configuration import SSOConfiguration, SSOProvider
from uwos.core.models.login.user import User
from uwos.core.models.notes.note import Note
from uwos.core.models.permissions.content_group_link import ContentGroupLink
from uwos.core.models.permissions.content_permission import ContentPermission
from uwos.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uwos.core.models.settings.settings_profile import SettingsProfile
from uwos.core.models.shared import (
    AttendeeRole,
    AttendeeStatus,
    CalendarType,
    ContentType,
    DayOfWeek,
    PermissionLevel,
    RecurrencePattern,
    ResourceType,
    SubjectType,
    VisibilityScope,
)

__all__ = [
    # Login models
    "User",
    "Organization",
    "OrganizationMember",
    "OrganizationRole",
    "Group",
    "GroupMember",
    "GroupRole",
    "SSOConfiguration",
    "SSOProvider",
    # Notes models
    "Note",
    # Calendar models
    "Calendar",
    "Category",
    "CalendarEvent",
    "EventAttendee",
    # Permission models
    "ContentGroupLink",
    "ContentPermission",
    "OrganizationPermissionDefaults",
    "VisibilityScope",
    "ContentType",
    "PermissionLevel",
    "SubjectType",
    "RecurrencePattern",
    "DayOfWeek",
    "AttendeeStatus",
    "AttendeeRole",
    "CalendarType",
    "ResourceType",
]
