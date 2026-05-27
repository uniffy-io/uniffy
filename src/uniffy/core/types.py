"""
Shared enums and utility types used across all UNIFFY modules.

This module is dependency-free (stdlib only) so it can be safely
imported by any other module without risking circular imports.
Everything that needs a shared enum imports it from here.
"""

import re
from enum import Enum
from uuid import uuid7

# Central ID generator for all models. Using UUIDv7 (time-ordered, RFC 9562).
# Change this single binding if the ID generation strategy ever changes.
generate_id = uuid7


# Access control


class ContentRole(str, Enum):
    """
    Role a subject has on a piece of content.

    Higher in the list = more privilege. ``BLOCKED`` is an explicit deny
    that overrides any baseline access. Use ``BLOCKED`` to remove a
    specific user from otherwise open content.
    """

    OWNER = "OWNER"
    ADMIN = "ADMIN"
    EDITOR = "EDITOR"
    COMMENTER = "COMMENTER"
    VIEWER = "VIEWER"
    BLOCKED = "BLOCKED"


class AccessMode(str, Enum):
    """
    Baseline access mode for a piece of content.

    Explicit :class:`ContentMember` rows always override the baseline
    (in either direction -- higher or ``BLOCKED``).
    """

    OWNER_ONLY = "OWNER_ONLY"
    EXPLICIT_MEMBERS = "EXPLICIT_MEMBERS"
    OPEN_TO_ORG = "OPEN_TO_ORG"


class ContentMemberAction(str, Enum):
    """Wire-level action label for permissions audit events.

    Mapped to ``audit_events.action`` strings of the form
    ``permissions.*`` by the permissions converter; this enum stays
    because the ``permissions.v1`` proto contract still exposes it.
    """

    MEMBER_ADDED = "MEMBER_ADDED"
    MEMBER_ROLE_CHANGED = "MEMBER_ROLE_CHANGED"
    MEMBER_REMOVED = "MEMBER_REMOVED"
    ACCESS_MODE_CHANGED = "ACCESS_MODE_CHANGED"
    BASELINE_ROLE_CHANGED = "BASELINE_ROLE_CHANGED"
    OWNERSHIP_TRANSFERRED = "OWNERSHIP_TRANSFERRED"


class ContentType(str, Enum):
    """
    Types of content in the system.

    Used for polymorphic references in access control, search,
    attachments, and related tables.
    """

    NOTE = "NOTE"
    FILE = "FILE"
    FOLDER = "FOLDER"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    USER = "USER"
    PROJECT = "PROJECT"
    TASK = "TASK"
    AGENT = "AGENT"
    PROVIDER_KEY = "PROVIDER_KEY"
    PROMPT = "PROMPT"
    AGENT_CRON_TASK = "AGENT_CRON_TASK"
    CHAT = "CHAT"
    AGENT_CHAT = "AGENT_CHAT"
    ROOM = "ROOM"
    TAG = "TAG"


class SubjectType(str, Enum):
    """
    Types of subjects that can have a role on content or be a participant
    in a chat channel/thread.
    """

    USER = "USER"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"
    AGENT = "AGENT"


class DomainType(str, Enum):
    """
    Application domains that support domain-level admins.

    A user can be granted admin status for a specific domain, giving
    them elevated access within that domain without being a full org
    admin.
    """

    CHAT = "CHAT"
    FILES = "FILES"
    NOTES = "NOTES"
    CALENDAR = "CALENDAR"
    PROJECTS = "PROJECTS"
    AGENTS = "AGENTS"


class NodeType(str, Enum):
    """Type of a node in the notes hierarchy."""

    NOTE = "NOTE"
    FOLDER = "FOLDER"
    TEMPLATE = "TEMPLATE"
    CANVAS = "CANVAS"


class CalendarType(str, Enum):
    """Types of calendars."""

    PERSONAL = "PERSONAL"
    WORK = "WORK"
    TEAM = "TEAM"
    SHARED = "SHARED"


class RecurrencePattern(str, Enum):
    """Recurrence patterns for repeating calendar events."""

    NONE = "NONE"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"


class DayOfWeek(str, Enum):
    """Days of the week for weekly recurrence."""

    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"
    SATURDAY = "SATURDAY"
    SUNDAY = "SUNDAY"


class AttendeeStatus(str, Enum):
    """Response status for event attendees."""

    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    TENTATIVE = "TENTATIVE"
    DECLINED = "DECLINED"


class AttendeeRole(str, Enum):
    """Role of an attendee in an event."""

    ORGANIZER = "ORGANIZER"
    REQUIRED = "REQUIRED"
    OPTIONAL = "OPTIONAL"


class ResourceType(str, Enum):
    """Types of linked resources for calendar events."""

    NOTE = "NOTE"
    FILE = "FILE"
    CHAT = "CHAT"


class NotificationType(str, Enum):
    """Types of notifications in the system."""

    CONTENT_SHARED = "CONTENT_SHARED"
    CONTENT_MENTIONED = "CONTENT_MENTIONED"
    CONTENT_EDITED = "CONTENT_EDITED"
    CALENDAR_REMINDER = "CALENDAR_REMINDER"
    CALENDAR_INVITE = "CALENDAR_INVITE"
    CALENDAR_RESPONSE = "CALENDAR_RESPONSE"
    PERMISSION_GRANTED = "PERMISSION_GRANTED"
    PERMISSION_REVOKED = "PERMISSION_REVOKED"
    SYSTEM_ANNOUNCEMENT = "SYSTEM_ANNOUNCEMENT"
    COMMENT_ADDED = "COMMENT_ADDED"
    COMMENT_REPLY = "COMMENT_REPLY"
    COMMENT_MENTIONED = "COMMENT_MENTIONED"
    COMMENT_RESOLVED = "COMMENT_RESOLVED"
    TASK_ASSIGNED = "TASK_ASSIGNED"
    TASK_DUE_SOON = "TASK_DUE_SOON"
    TASK_OVERDUE = "TASK_OVERDUE"
    CHAT_MENTION = "CHAT_MENTION"
    CHAT_DM = "CHAT_DM"
    CHAT_CHANNEL_INVITE = "CHAT_CHANNEL_INVITE"
    CHAT_CHANNEL_REMOVED = "CHAT_CHANNEL_REMOVED"
    CHAT_THREAD_REPLY = "CHAT_THREAD_REPLY"
    AGENTS_BUDGET_ALERT = "AGENTS_BUDGET_ALERT"
    SUPPORT_SESSION_REQUESTED = "SUPPORT_SESSION_REQUESTED"
    SUPPORT_SESSION_STARTED = "SUPPORT_SESSION_STARTED"
    SUPPORT_SESSION_REVOKED = "SUPPORT_SESSION_REVOKED"
    SUPPORT_SESSION_EXPIRED = "SUPPORT_SESSION_EXPIRED"


class RoomType(str, Enum):
    """Types of bookable rooms and resources."""

    MEETING_ROOM = "MEETING_ROOM"
    CONFERENCE_ROOM = "CONFERENCE_ROOM"
    OFFICE = "OFFICE"
    OTHER = "OTHER"


class RoomStatus(str, Enum):
    """Operational status of a room or resource."""

    ACTIVE = "ACTIVE"
    MAINTENANCE = "MAINTENANCE"
    RETIRED = "RETIRED"


class BookingStatus(str, Enum):
    """Status of a room booking."""

    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


def slugify(text: str, max_length: int = 500) -> str:
    """Convert text to a URL-friendly slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text.strip("-")[:max_length]


__all__ = [
    "AccessMode",
    "AttendeeRole",
    "AttendeeStatus",
    "BookingStatus",
    "CalendarType",
    "ContentMemberAction",
    "ContentRole",
    "ContentType",
    "DayOfWeek",
    "DomainType",
    "NodeType",
    "NotificationType",
    "RecurrencePattern",
    "ResourceType",
    "RoomStatus",
    "RoomType",
    "SubjectType",
    "generate_id",
    "slugify",
]
