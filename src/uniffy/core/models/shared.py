"""Shared models, enums, and base classes for content types."""

from enum import Enum


class VisibilityScope(str, Enum):
    """
    Visibility scope for content items.

    Defines who can access a piece of content within an organization.

    Attributes
    ----------
    PRIVATE : str
        Personal space - only the owner can access.
    GROUP : str
        Group space - accessible to members of associated group(s).
    ORGANIZATION : str
        Organization space - accessible to all members of the organization.
    PUBLIC : str
        Public - accessible to anyone (for future external sharing features).

    """

    PRIVATE = "PRIVATE"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"
    PUBLIC = "PUBLIC"


class PermissionLevel(str, Enum):
    """
    Permission levels for content access.

    Defines what actions a user can perform on a piece of content.

    Attributes
    ----------
    VIEW : str
        Can view content but not modify it.
    EDIT : str
        Can view and edit content but not delete or share.
    ADMIN : str
        Can view, edit, delete, and share content.
    OWNER : str
        Full control including transfer of ownership.

    """

    VIEW = "VIEW"
    EDIT = "EDIT"
    ADMIN = "ADMIN"
    OWNER = "OWNER"


class NodeType(str, Enum):
    """
    Node type for notes hierarchy.

    Defines the type of a note in the hierarchy.

    Attributes
    ----------
    NOTE : str
        Regular note with content.
    FOLDER : str
        Folder for organizing notes (can also have content).
    TEMPLATE : str
        Template note for creating new notes (future use).

    """

    NOTE = "NOTE"
    FOLDER = "FOLDER"
    TEMPLATE = "TEMPLATE"


class ContentType(str, Enum):
    """
    Types of content in the system.

    Used for polymorphic references in permission tables.

    Attributes
    ----------
    NOTE : str
        Notes/documents.
    FILE : str
        Files (uploaded documents, images, etc.).
    CALENDAR_EVENT : str
        Calendar events.
    CHAT_MESSAGE : str
        Chat messages.
    USER : str
        User profiles (for @mentions and references).

    """

    NOTE = "NOTE"
    FILE = "FILE"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    USER = "USER"


class SubjectType(str, Enum):
    """
    Types of subjects that can have permissions.

    Used to identify who or what has access to content.

    Attributes
    ----------
    USER : str
        Individual user.
    GROUP : str
        Group of users.
    ORGANIZATION : str
        Entire organization.

    """

    USER = "USER"
    GROUP = "GROUP"
    ORGANIZATION = "ORGANIZATION"


class RecurrencePattern(str, Enum):
    """
    Recurrence patterns for repeating calendar events.

    Attributes
    ----------
    NONE : str
        No recurrence (single event).
    DAILY : str
        Repeats every day.
    WEEKLY : str
        Repeats every week.
    BIWEEKLY : str
        Repeats every two weeks.
    MONTHLY : str
        Repeats every month.
    YEARLY : str
        Repeats every year.

    """

    NONE = "NONE"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"


class DayOfWeek(str, Enum):
    """
    Days of the week for weekly recurrence.

    Attributes
    ----------
    MONDAY : str
        Monday.
    TUESDAY : str
        Tuesday.
    WEDNESDAY : str
        Wednesday.
    THURSDAY : str
        Thursday.
    FRIDAY : str
        Friday.
    SATURDAY : str
        Saturday.
    SUNDAY : str
        Sunday.

    """

    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"
    SATURDAY = "SATURDAY"
    SUNDAY = "SUNDAY"


class AttendeeStatus(str, Enum):
    """
    Response status for event attendees.

    Attributes
    ----------
    PENDING : str
        No response yet.
    ACCEPTED : str
        Confirmed attendance.
    TENTATIVE : str
        Maybe attending.
    DECLINED : str
        Not attending.

    """

    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    TENTATIVE = "TENTATIVE"
    DECLINED = "DECLINED"


class AttendeeRole(str, Enum):
    """
    Role of an attendee in an event.

    Attributes
    ----------
    ORGANIZER : str
        Event creator/organizer.
    REQUIRED : str
        Must attend.
    OPTIONAL : str
        Optional attendance.

    """

    ORGANIZER = "ORGANIZER"
    REQUIRED = "REQUIRED"
    OPTIONAL = "OPTIONAL"


class CalendarType(str, Enum):
    """
    Types of calendars.

    Attributes
    ----------
    PERSONAL : str
        Personal calendar.
    WORK : str
        Work calendar.
    TEAM : str
        Team/shared calendar.
    SHARED : str
        Externally shared calendar.

    """

    PERSONAL = "PERSONAL"
    WORK = "WORK"
    TEAM = "TEAM"
    SHARED = "SHARED"


class NotificationType(str, Enum):
    """
    Types of notifications in the system.

    Attributes
    ----------
    CONTENT_SHARED : str
        Content was shared with the user.
    CONTENT_MENTIONED : str
        User was mentioned in content.
    CONTENT_EDITED : str
        Content the user follows was edited.
    CALENDAR_REMINDER : str
        Calendar event reminder.
    CALENDAR_INVITE : str
        User was invited to a calendar event.
    CALENDAR_RESPONSE : str
        An attendee responded to an event invitation.
    PERMISSION_GRANTED : str
        Permission was granted to the user.
    PERMISSION_REVOKED : str
        Permission was revoked from the user.
    SYSTEM_ANNOUNCEMENT : str
        System-wide announcement.

    """

    CONTENT_SHARED = "CONTENT_SHARED"
    CONTENT_MENTIONED = "CONTENT_MENTIONED"
    CONTENT_EDITED = "CONTENT_EDITED"
    CALENDAR_REMINDER = "CALENDAR_REMINDER"
    CALENDAR_INVITE = "CALENDAR_INVITE"
    CALENDAR_RESPONSE = "CALENDAR_RESPONSE"
    PERMISSION_GRANTED = "PERMISSION_GRANTED"
    PERMISSION_REVOKED = "PERMISSION_REVOKED"
    SYSTEM_ANNOUNCEMENT = "SYSTEM_ANNOUNCEMENT"


class ResourceType(str, Enum):
    """
    Types of linked resources for calendar events.

    Attributes
    ----------
    NOTE : str
        Linked note.
    FILE : str
        Linked file.
    CHAT : str
        Linked chat.

    """

    NOTE = "NOTE"
    FILE = "FILE"
    CHAT = "CHAT"
