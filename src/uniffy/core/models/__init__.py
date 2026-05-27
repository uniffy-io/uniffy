"""Database models package."""

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.prompt import AgentPrompt
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.app_settings.application_setting import ApplicationSetting
from uniffy.core.models.attachments.attachment import Attachment
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.bookmarks.bookmark import Bookmark
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.template import EventTemplate
from uniffy.core.models.chat import (
    ChannelRole,
    ChatChannel,
    ChatChannelCategory,
    ChatChannelMember,
    ChatChannelResource,
    ChatChannelStats,
    ChatMessage,
    ChatNotificationLevel,
    ChatReaction,
    ChatReadCursor,
    ChatThread,
    ChatThreadFollow,
    ChatThreadParticipant,
    ChatThreadReadCursor,
    ChatThreadStats,
    SenderType,
)
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.crypto.deployment_encryption_key import DeploymentEncryptionKey
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.files.file import ExtractionStatus, File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.media_info import FileMediaInfo
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember, GroupRole
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.password_reset_token import PasswordResetToken
from uniffy.core.models.login.platform_mfa_reset_request import PlatformMfaResetRequest
from uniffy.core.models.login.sso_configuration import SSOConfiguration, SSOProvider
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_recovery_code import UserRecoveryCode
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.models.mail.suppression import EmailSuppression, EmailSuppressionReason
from uniffy.core.models.notes.note import Note
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.notifications.push_subscription import PushSubscription
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.models.shared import (
    AccessMode,
    AttendeeRole,
    AttendeeStatus,
    CalendarType,
    ContentMemberAction,
    ContentRole,
    ContentType,
    DayOfWeek,
    DomainType,
    NotificationType,
    RecurrencePattern,
    ResourceType,
    SubjectType,
)
from uniffy.core.models.tags import Tag, TagAssignment

__all__ = [
    # Application settings
    "ApplicationSetting",
    # Attachments
    "Attachment",
    # Audit
    "AuditEvent",
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
    "UserMfa",
    "UserRecoveryCode",
    "PlatformMfaResetRequest",
    "PasswordResetToken",
    "Invitation",
    # Mail
    "EmailSuppression",
    "EmailSuppressionReason",
    # Org settings (KV)
    "OrgSetting",
    # Deployment settings (KV)
    "DeploymentSetting",
    "DeploymentEncryptionKey",
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
    # Agents
    "Agent",
    "AgentMessage",
    "AgentSession",
    "AgentPrompt",
    "AgentSkill",
    "ProviderKey",
    # Crypto
    "OrgEncryptionKey",
    # Comments
    "Comment",
    "CommentAnchorType",
    "CommentReaction",
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
    "ContentMember",
    "DomainAdmin",
    "OrganizationPermissionDefaults",
    "DomainType",
    "AccessMode",
    "ContentMemberAction",
    "ContentRole",
    "ContentType",
    "SubjectType",
    "RecurrencePattern",
    "DayOfWeek",
    "AttendeeStatus",
    "AttendeeRole",
    "CalendarType",
    "ResourceType",
    "SettingsProfile",
    "EventTemplate",
    # Chat models
    "ChatChannel",
    "ChatChannelCategory",
    "ChatChannelMember",
    "ChatChannelResource",
    "ChatChannelStats",
    "ChatMessage",
    "ChatReaction",
    "ChatReadCursor",
    "ChatThread",
    "ChatThreadFollow",
    "ChatThreadParticipant",
    "ChatThreadReadCursor",
    "ChatThreadStats",
    "ChannelRole",
    "ChatNotificationLevel",
    "SenderType",
    # Tags
    "Tag",
    "TagAssignment",
    # Realtime
    "RealtimeYjsSnapshot",
    # Platform (support sessions)
    "SupportSession",
    "SupportSessionScope",
    "SupportSessionState",
]
