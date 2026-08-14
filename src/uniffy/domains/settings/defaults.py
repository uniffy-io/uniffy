"""Default settings merged with user profile overrides at runtime.

New keys added here become available to existing users without a migration.
"""

from dataclasses import dataclass
from typing import Any

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


DEFAULT_REMINDER_INTERVALS: list[int] = [15]


@dataclass(frozen=True)
class NotificationsDefaults:
    browser_enabled: bool = True
    email_enabled: bool = True
    sound_enabled: bool = True
    email_frequency: str = "instant"
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    toast_enabled: bool = True


# Per-notification-type channel preferences. Keys are NotificationType values.
DEFAULT_NOTIFICATION_CHANNELS: dict[str, dict[str, bool]] = {
    "CONTENT_SHARED": {"in_app": True, "browser": True, "email": True},
    "CONTENT_MENTIONED": {"in_app": True, "browser": True, "email": True},
    "CONTENT_EDITED": {"in_app": True, "browser": False, "email": False},
    "CALENDAR_REMINDER": {"in_app": True, "browser": True, "email": False},
    "CALENDAR_INVITE": {"in_app": True, "browser": True, "email": True},
    "CALENDAR_RESPONSE": {"in_app": True, "browser": False, "email": False},
    "PERMISSION_GRANTED": {"in_app": True, "browser": False, "email": True},
    "PERMISSION_REVOKED": {"in_app": True, "browser": False, "email": True},
    "SYSTEM_ANNOUNCEMENT": {"in_app": True, "browser": True, "email": True},
    "COMMENT_ADDED": {"in_app": True, "browser": True, "email": False},
    "COMMENT_REPLY": {"in_app": True, "browser": True, "email": True},
    "COMMENT_MENTIONED": {"in_app": True, "browser": True, "email": True},
    "COMMENT_RESOLVED": {"in_app": True, "browser": False, "email": False},
    "CHAT_MENTION": {"in_app": True, "browser": True, "email": False},
    "CHAT_DM": {"in_app": True, "browser": True, "email": False},
    "CHAT_CHANNEL_INVITE": {"in_app": True, "browser": False, "email": False},
    "CHAT_CHANNEL_REMOVED": {"in_app": True, "browser": False, "email": False},
    "CHAT_THREAD_REPLY": {"in_app": True, "browser": False, "email": False},
}


APPEARANCE_DEFAULTS = AppearanceDefaults()
NOTIFICATIONS_DEFAULTS = NotificationsDefaults()


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

    if "bindings" in overrides and overrides["bindings"]:
        result["bindings"] = {**result["bindings"], **overrides["bindings"]}

    return result


def get_effective_notifications(overrides: dict[str, Any] | None) -> dict[str, Any]:
    return merge_with_defaults(overrides, get_notifications_defaults_dict())


def get_effective_notification_channels(
    notification_type: str,
    overrides: dict[str, Any] | None,
) -> dict[str, bool]:
    """Resolve channel prefs for a NotificationType, applying master switches last."""
    defaults = DEFAULT_NOTIFICATION_CHANNELS.get(
        notification_type,
        {"in_app": True, "browser": True, "email": True},
    )
    channels = defaults.copy()

    effective = get_effective_notifications(overrides)
    user_channel_overrides = effective.get("channel_overrides", {})
    if notification_type in user_channel_overrides:
        type_overrides = user_channel_overrides[notification_type]
        for channel, enabled in type_overrides.items():
            if enabled is not None:
                channels[channel] = enabled

    # Master switches override per-type prefs.
    if not effective.get("browser_enabled", True):
        channels["browser"] = False
    if not effective.get("email_enabled", True):
        channels["email"] = False

    return channels
