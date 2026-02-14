"""Database models package."""

from uniffy.core.models.app_settings.application_setting import ApplicationSetting
from uniffy.core.models.attachments.attachment import Attachment
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.sso_configuration import SSOConfiguration, SSOProvider
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.models.notes.note import Note
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.push_subscription import PushSubscription
from uniffy.core.models.permissions.content_group_link import ContentGroupLink
from uniffy.core.models.permissions.content_permission import ContentPermission
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.models.shared import (
    AttendeeRole,
    AttendeeStatus,
    CalendarType,
    ContentType,
    DayOfWeek,
    NotificationType,
    PermissionLevel,
    RecurrencePattern,
    ResourceType,
    SubjectType,
    VisibilityScope,
)

__all__ = [
    # Application settings
    "ApplicationSetting",
    # Attachments
    "Attachment",
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
    "UserSession",
    # Notes models
    "Note",
    # Projects models
    "Project",
    "Task",
    "FieldDefinition",
    "ViewConfig",
    "TaskActivity",
    # Files models
    "File",
    "FileMediaInfo",
    "Folder",
    "FileVersion",
    "MultipartUpload",
    "ExtractionStatus",
    "UploadStatus",
    # Bookmarks
    "Bookmark",
    # Comments
    "Comment",
    "CommentAnchorType",
    "CommentReaction",
    # Notifications
    "Notification",
    "NotificationType",
    "PushSubscription",
    # Calendar models
    "Calendar",
    "Category",
    "CalendarEvent",
    "EventAttendee",
    "EventReminder",
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
    "SettingsProfile",
    "EventTemplate",
]
