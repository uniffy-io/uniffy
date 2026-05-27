"""Shared enums and utility types. Stdlib-only to stay circular-import-safe."""

import re
from enum import Enum
from uuid import uuid7

# UUIDv7 keeps IDs time-ordered (RFC 9562).
generate_id = uuid7


class ContentRole(str, Enum):
    """Role a subject has on a piece of content.

    Order is OWNER > ADMIN > EDITOR > COMMENTER > VIEWER. ``BLOCKED`` is an
    explicit deny that overrides any baseline access.
    """

    OWNER = "OWNER"
    ADMIN = "ADMIN"
    EDITOR = "EDITOR"
    COMMENTER = "COMMENTER"
    VIEWER = "VIEWER"
    BLOCKED = "BLOCKED"


class AccessMode(str, Enum):
    """Baseline access mode for content. Explicit ContentMember rows override the baseline."""

    OWNER_ONLY = "OWNER_ONLY"
    EXPLICIT_MEMBERS = "EXPLICIT_MEMBERS"
    OPEN_TO_ORG = "OPEN_TO_ORG"


class ContentMemberAction(str, Enum):
    """Wire-level action label for permissions audit events (exposed via permissions.v1 proto)."""

    MEMBER_ADDED = "MEMBER_ADDED"
    MEMBER_ROLE_CHANGED = "MEMBER_ROLE_CHANGED"
    MEMBER_REMOVED = "MEMBER_REMOVED"
    ACCESS_MODE_CHANGED = "ACCESS_MODE_CHANGED"
    BASELINE_ROLE_CHANGED = "BASELINE_ROLE_CHANGED"
    OWNERSHIP_TRANSFERRED = "OWNERSHIP_TRANSFERRED"


class ContentType(str, Enum):
    """Content types referenced polymorphically by access control, search, attachments, etc."""

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
    """Subjects that can hold a role on content or participate in a chat channel/thread."""

    USER = "USER"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"
    AGENT = "AGENT"


class DomainType(str, Enum):
    """Application domains that support per-domain admins (elevated access without org admin)."""

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
