"""Default settings merged with user profile overrides at runtime.

New keys added here become available to existing users without a migration.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from uniffy.core.types import NotificationType

# Key: action identifier (dot-separated namespace). Value: shortcut (Ctrl == Cmd on macOS).
DEFAULT_KEYBOARD_SHORTCUTS: dict[str, str] = {
    "nav.search": "Ctrl+K",
    "app.settings": "Ctrl+,",
    "app.commandPalette": "Ctrl+Shift+P",
    "app.help": "F1",
    "app.zenMode": "Ctrl+\\",
    "app.toggleSidebar": "Ctrl+B",
    "app.showUploads": "Ctrl+U",
    "viewer.close": "Escape",
    "viewer.next": "ArrowRight",
    "viewer.previous": "ArrowLeft",
    "viewer.togglePlay": "Space",
    "viewer.fullscreen": "F",
    "viewer.zoomIn": "=",
    "viewer.zoomOut": "-",
    "viewer.zoomReset": "0",
    "viewer.rotateRight": "R",
    "viewer.download": "Ctrl+S",
    "viewer.edit": "E",
    "viewer.toggleSidebar": "T",
    "viewer.search": "Ctrl+F",
    "viewer.print": "Ctrl+P",
    "imageEditor.undo": "Ctrl+Z",
    "imageEditor.redo": "Ctrl+Shift+Z",
    "imageEditor.save": "Ctrl+S",
    "imageEditor.cancel": "Escape",
    "imageEditor.rotateRight": "R",
    "imageEditor.rotateLeft": "Shift+R",
    "imageEditor.flipH": "H",
    "imageEditor.flipV": "V",
    "imageEditor.crop": "C",
    "imageEditor.applyCrop": "Enter",
    "comments.toggle": "Ctrl+Shift+M",
    "comments.new": "Ctrl+Shift+C",
    "projects.focusUp": "ArrowUp",
    "projects.focusDown": "ArrowDown",
    "projects.focusLeft": "ArrowLeft",
    "projects.focusRight": "ArrowRight",
    "projects.editCell": "Enter",
    "projects.cancelEdit": "Escape",
    "projects.toggleSelect": "Space",
    "projects.undo": "Ctrl+Z",
    "projects.redo": "Ctrl+Shift+Z",
    "canvas.addText": "T",
    "canvas.addShape": "S",
    "canvas.deleteSelected": "Delete",
    "canvas.selectAll": "Ctrl+A",
    "canvas.fitView": "Ctrl+Shift+1",
    "canvas.zoomIn": "Ctrl+=",
    "canvas.zoomOut": "Ctrl+-",
    "canvas.undo": "Ctrl+Z",
    "canvas.redo": "Ctrl+Shift+Z",
    "recording.toggleQuickClip": "Ctrl+Alt+S",
    # Notes editor entries are tooltip-only; Milkdown owns the actual keymap.
    "editor.undo": "Ctrl+Z",
    "editor.redo": "Ctrl+Shift+Z",
    "chat.newMessage": "N",
    "chat.search": "Ctrl+F",
    "chat.prevChannel": "Alt+ArrowUp",
    "chat.nextChannel": "Alt+ArrowDown",
    "chat.toggleThread": "T",
    "chat.markRead": "Escape",
    "chat.editLast": "ArrowUp",
    "chat.replyThread": "R",
    "chat.emojiPicker": "Ctrl+Shift+E",
}


@dataclass(frozen=True)
class AppearanceDefaults:
    theme: str = "system"
    accent_color: str | None = None
    font_family: str = "inter"
    sidebar_collapsed: bool = False
    compact_mode: bool = False
    default_editor: str = "crepe"  # one of: "crepe", "markdown", "readonly"
    mention_display: str = "expanded"  # one of: "expanded", "compact"
    markdown_show_preview: bool = True
    markdown_show_line_numbers: bool = True
    timezone: str | None = None  # IANA zone; None = automatic (browser/device)
    week_start: str = "monday"  # one of: "monday", "saturday", "sunday"


WORKDAY_NAMES: tuple[str, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


@dataclass(frozen=True)
class SchedulingDefaults:
    workday_start: str = "09:00"  # 24h HH:MM on the user's own clock
    workday_end: str = "18:00"
    workdays: tuple[str, ...] = WORKDAY_NAMES[:5]


DEFAULT_REMINDER_INTERVALS: list[int] = [15]


class EmailFrequency(StrEnum):
    INSTANT = "instant"
    HOURLY = "hourly"
    DAILY = "daily"


@dataclass(frozen=True)
class NotificationsDefaults:
    browser_enabled: bool = True
    email_enabled: bool = True
    sound_enabled: bool = True
    email_frequency: EmailFrequency = EmailFrequency.INSTANT
    email_digest_time: str = "08:00"
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    toast_enabled: bool = True


DEFAULT_NOTIFICATION_CHANNELS: dict[NotificationType, dict[str, bool]] = {
    NotificationType.CONTENT_SHARED: {"in_app": True, "browser": True, "email": True},
    NotificationType.CONTENT_MENTIONED: {"in_app": True, "browser": True, "email": True},
    NotificationType.CONTENT_EDITED: {"in_app": True, "browser": False, "email": False},
    NotificationType.CALENDAR_REMINDER: {"in_app": True, "browser": True, "email": False},
    NotificationType.CALENDAR_INVITE: {"in_app": True, "browser": True, "email": True},
    NotificationType.CALENDAR_RESPONSE: {"in_app": True, "browser": False, "email": False},
    NotificationType.CALENDAR_CANCELLED: {"in_app": True, "browser": True, "email": True},
    NotificationType.PERMISSION_GRANTED: {"in_app": True, "browser": False, "email": True},
    NotificationType.PERMISSION_REVOKED: {"in_app": True, "browser": False, "email": True},
    NotificationType.SYSTEM_ANNOUNCEMENT: {"in_app": True, "browser": True, "email": True},
    NotificationType.COMMENT_ADDED: {"in_app": True, "browser": True, "email": False},
    NotificationType.COMMENT_REPLY: {"in_app": True, "browser": True, "email": True},
    NotificationType.COMMENT_MENTIONED: {"in_app": True, "browser": True, "email": True},
    NotificationType.COMMENT_RESOLVED: {"in_app": True, "browser": False, "email": False},
    NotificationType.TASK_ASSIGNED: {"in_app": True, "browser": True, "email": True},
    NotificationType.TASK_DUE_SOON: {"in_app": True, "browser": True, "email": True},
    NotificationType.TASK_OVERDUE: {"in_app": True, "browser": True, "email": True},
    NotificationType.CHAT_MENTION: {"in_app": True, "browser": True, "email": True},
    NotificationType.CHAT_DM: {"in_app": True, "browser": True, "email": True},
    NotificationType.CHAT_CHANNEL_INVITE: {"in_app": True, "browser": False, "email": False},
    NotificationType.CHAT_CHANNEL_REMOVED: {"in_app": True, "browser": False, "email": False},
    NotificationType.CHAT_THREAD_REPLY: {"in_app": True, "browser": False, "email": False},
    NotificationType.ACCESS_REQUESTED: {"in_app": True, "browser": True, "email": True},
    NotificationType.ACCESS_REQUEST_DENIED: {"in_app": True, "browser": True, "email": False},
    NotificationType.AGENTS_BUDGET_ALERT: {"in_app": True, "browser": True, "email": True},
    NotificationType.SUPPORT_SESSION_REQUESTED: {
        "in_app": True,
        "browser": True,
        "email": False,
    },
    NotificationType.SUPPORT_SESSION_STARTED: {
        "in_app": True,
        "browser": True,
        "email": False,
    },
    NotificationType.SUPPORT_SESSION_REVOKED: {
        "in_app": True,
        "browser": True,
        "email": False,
    },
    NotificationType.SUPPORT_SESSION_EXPIRED: {
        "in_app": True,
        "browser": True,
        "email": False,
    },
}

TRANSACTIONAL_EMAIL_NOTIFICATION_TYPES = {
    NotificationType.SUPPORT_SESSION_REQUESTED,
    NotificationType.SUPPORT_SESSION_STARTED,
    NotificationType.SUPPORT_SESSION_REVOKED,
}


APPEARANCE_DEFAULTS = AppearanceDefaults()
NOTIFICATIONS_DEFAULTS = NotificationsDefaults()
SCHEDULING_DEFAULTS = SchedulingDefaults()


def get_scheduling_defaults_dict() -> dict[str, Any]:
    return {
        "workday_start": SCHEDULING_DEFAULTS.workday_start,
        "workday_end": SCHEDULING_DEFAULTS.workday_end,
        "workdays": list(SCHEDULING_DEFAULTS.workdays),
    }


def get_effective_scheduling(overrides: dict[str, Any] | None) -> dict[str, Any]:
    return merge_with_defaults(overrides, get_scheduling_defaults_dict())


def get_appearance_defaults_dict() -> dict[str, Any]:
    return {
        "theme": APPEARANCE_DEFAULTS.theme,
        "accent_color": APPEARANCE_DEFAULTS.accent_color,
        "font_family": APPEARANCE_DEFAULTS.font_family,
        "sidebar_collapsed": APPEARANCE_DEFAULTS.sidebar_collapsed,
        "compact_mode": APPEARANCE_DEFAULTS.compact_mode,
        "default_editor": APPEARANCE_DEFAULTS.default_editor,
        "mention_display": APPEARANCE_DEFAULTS.mention_display,
        "markdown_show_preview": APPEARANCE_DEFAULTS.markdown_show_preview,
        "markdown_show_line_numbers": APPEARANCE_DEFAULTS.markdown_show_line_numbers,
        "timezone": APPEARANCE_DEFAULTS.timezone,
        "week_start": APPEARANCE_DEFAULTS.week_start,
    }


def get_notifications_defaults_dict() -> dict[str, Any]:
    return {
        "browser_enabled": NOTIFICATIONS_DEFAULTS.browser_enabled,
        "email_enabled": NOTIFICATIONS_DEFAULTS.email_enabled,
        "sound_enabled": NOTIFICATIONS_DEFAULTS.sound_enabled,
        "email_frequency": NOTIFICATIONS_DEFAULTS.email_frequency,
        "email_digest_time": NOTIFICATIONS_DEFAULTS.email_digest_time,
        "quiet_hours_start": NOTIFICATIONS_DEFAULTS.quiet_hours_start,
        "quiet_hours_end": NOTIFICATIONS_DEFAULTS.quiet_hours_end,
        "toast_enabled": NOTIFICATIONS_DEFAULTS.toast_enabled,
        "channel_overrides": {},
        "default_reminder_intervals": DEFAULT_REMINDER_INTERVALS,
    }


def get_keyboard_shortcuts_defaults_dict() -> dict[str, Any]:
    return {"bindings": DEFAULT_KEYBOARD_SHORTCUTS.copy()}


def merge_with_defaults(
    overrides: dict[str, Any] | None,
    defaults: dict[str, Any],
) -> dict[str, Any]:
    """Shallow merge of overrides into defaults; nested dicts merge one level deep."""
    if overrides is None:
        return defaults.copy()

    result = defaults.copy()

    for key, value in overrides.items():
        if value is not None:
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = {**result[key], **value}
            else:
                result[key] = value

    return result


def get_effective_appearance(overrides: dict[str, Any] | None) -> dict[str, Any]:
    return merge_with_defaults(overrides, get_appearance_defaults_dict())


def get_effective_keyboard_shortcuts(overrides: dict[str, Any] | None) -> dict[str, Any]:
    defaults = get_keyboard_shortcuts_defaults_dict()
    if overrides is None:
        return defaults

    result = defaults.copy()

    if "bindings" in overrides and overrides["bindings"]:  # noqa: PLR2004
        result["bindings"] = {**result["bindings"], **overrides["bindings"]}

    return result


def get_effective_notifications(overrides: dict[str, Any] | None) -> dict[str, Any]:
    return merge_with_defaults(overrides, get_notifications_defaults_dict())


def get_effective_notification_channels(
    notification_type: NotificationType,
    overrides: dict[str, Any] | None,
) -> dict[str, bool]:
    """Resolve channel prefs for a NotificationType, applying master switches last."""
    channels = DEFAULT_NOTIFICATION_CHANNELS[notification_type].copy()

    effective = get_effective_notifications(overrides)
    user_channel_overrides = effective.get("channel_overrides", {})
    notification_type_key = notification_type.value
    if notification_type_key in user_channel_overrides:
        type_overrides = user_channel_overrides[notification_type_key]
        for channel, enabled in type_overrides.items():
            if enabled is not None:
                channels[channel] = enabled

    # Master switches override per-type prefs.
    if not effective.get("browser_enabled", True):
        channels["browser"] = False
    if not effective.get("email_enabled", True):
        channels["email"] = False
    if notification_type in TRANSACTIONAL_EMAIL_NOTIFICATION_TYPES:
        channels["email"] = False

    return channels
