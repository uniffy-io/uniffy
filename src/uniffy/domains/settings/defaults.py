"""Code-defined default settings for the Settings Framework.

This module contains all default settings values. These defaults are merged
with user profile overrides at runtime. New settings added here are automatically
available to all users without migration.

Example usage:
    effective = merge_with_defaults(profile.appearance, APPEARANCE_DEFAULTS)
"""

from dataclasses import dataclass
from typing import Any

# Default keyboard shortcuts
# Key: action identifier (dot-separated namespace)
# Value: keyboard shortcut (platform-aware, Ctrl = Cmd on macOS)
DEFAULT_KEYBOARD_SHORTCUTS: dict[str, str] = {
    # Navigation actions
    "nav.search": "Ctrl+K",
    # App actions
    "app.settings": "Ctrl+,",
    "app.commandPalette": "Ctrl+Shift+P",
    "app.help": "F1",
    "app.zenMode": "Ctrl+\\",
    "app.toggleSidebar": "Ctrl+B",
    # File viewer actions
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
    # Image editor actions
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

    # Comments
    "comments.toggle": "Ctrl+Shift+M",
    "comments.new": "Ctrl+Shift+C",

    # Projects table keyboard navigation
    "projects.focusUp": "ArrowUp",
    "projects.focusDown": "ArrowDown",
    "projects.focusLeft": "ArrowLeft",
    "projects.focusRight": "ArrowRight",
    "projects.editCell": "Enter",
    "projects.cancelEdit": "Escape",
    "projects.toggleSelect": "Space",
    # Projects undo/redo
    "projects.undo": "Ctrl+Z",
    "projects.redo": "Ctrl+Shift+Z",
}


@dataclass(frozen=True)
class AppearanceDefaults:
    """Default appearance settings."""

    theme: str = "system"
    accent_color: str | None = None  # No default accent color (uses theme primary)
    font_family: str = "inter"
    sidebar_collapsed: bool = False
    compact_mode: bool = False
    default_editor: str = "crepe"  # Default editor for notes: "crepe", "markdown", "readonly"


DEFAULT_REMINDER_INTERVALS: list[int] = [15]


@dataclass(frozen=True)
class NotificationsDefaults:
    """Default notification settings."""

    browser_enabled: bool = True
    email_enabled: bool = True
    sound_enabled: bool = True
    email_frequency: str = "instant"
    quiet_hours_start: str | None = None  # No quiet hours by default
    quiet_hours_end: str | None = None


# Default per-notification-type channel preferences.
# Keys are NotificationType values, values are channel -> enabled mappings.
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
}


# Singleton instances for easy access
APPEARANCE_DEFAULTS = AppearanceDefaults()
NOTIFICATIONS_DEFAULTS = NotificationsDefaults()


def get_appearance_defaults_dict() -> dict[str, Any]:
    """Get appearance defaults as a dictionary."""
    return {
        "theme": APPEARANCE_DEFAULTS.theme,
        "accent_color": APPEARANCE_DEFAULTS.accent_color,
        "font_family": APPEARANCE_DEFAULTS.font_family,
        "sidebar_collapsed": APPEARANCE_DEFAULTS.sidebar_collapsed,
        "compact_mode": APPEARANCE_DEFAULTS.compact_mode,
        "default_editor": APPEARANCE_DEFAULTS.default_editor,
    }


def get_notifications_defaults_dict() -> dict[str, Any]:
    """Get notifications defaults as a dictionary."""
    return {
        "browser_enabled": NOTIFICATIONS_DEFAULTS.browser_enabled,
        "email_enabled": NOTIFICATIONS_DEFAULTS.email_enabled,
        "sound_enabled": NOTIFICATIONS_DEFAULTS.sound_enabled,
        "email_frequency": NOTIFICATIONS_DEFAULTS.email_frequency,
        "quiet_hours_start": NOTIFICATIONS_DEFAULTS.quiet_hours_start,
        "quiet_hours_end": NOTIFICATIONS_DEFAULTS.quiet_hours_end,
        "channel_overrides": {},
        "default_reminder_intervals": DEFAULT_REMINDER_INTERVALS,
    }


def get_keyboard_shortcuts_defaults_dict() -> dict[str, Any]:
    """Get keyboard shortcuts defaults as a dictionary."""
    return {"bindings": DEFAULT_KEYBOARD_SHORTCUTS.copy()}


def merge_with_defaults(
    overrides: dict[str, Any] | None,
    defaults: dict[str, Any],
) -> dict[str, Any]:
    """
    Merge user overrides with code defaults.

    Performs a shallow merge where override values replace default values.
    For nested dictionaries (like keyboard_shortcuts.bindings), performs
    a deep merge.

    Parameters
    ----------
    overrides : dict | None
        User-specified overrides from the settings profile.
    defaults : dict
        Code-defined default values.

    Returns
    -------
    dict
        Merged settings with defaults filled in for missing values.

    """
    if overrides is None:
        return defaults.copy()

    result = defaults.copy()

    for key, value in overrides.items():
        if value is not None:
            # Deep merge for nested dictionaries
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = {**result[key], **value}
            else:
                result[key] = value

    return result


def get_effective_appearance(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Get effective appearance settings with defaults merged."""
    return merge_with_defaults(overrides, get_appearance_defaults_dict())


def get_effective_keyboard_shortcuts(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Get effective keyboard shortcuts with defaults merged."""
    defaults = get_keyboard_shortcuts_defaults_dict()
    if overrides is None:
        return defaults

    result = defaults.copy()

    # For keyboard shortcuts, merge the bindings dict
    if "bindings" in overrides and overrides["bindings"]:
        result["bindings"] = {**result["bindings"], **overrides["bindings"]}

    return result


def get_effective_notifications(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Get effective notification settings with defaults merged."""
    return merge_with_defaults(overrides, get_notifications_defaults_dict())


def get_effective_notification_channels(
    notification_type: str,
    overrides: dict[str, Any] | None,
) -> dict[str, bool]:
    """
    Get effective channel preferences for a notification type.

    Merges user channel_overrides with DEFAULT_NOTIFICATION_CHANNELS,
    then applies master switches (browser_enabled, email_enabled).

    Parameters
    ----------
    notification_type : str
        The NotificationType value (e.g., "CONTENT_SHARED").
    overrides : dict | None
        User's notification settings (including channel_overrides).

    Returns
    -------
    dict[str, bool]
        Effective channel preferences: {"in_app", "browser", "email"}.

    """
    # Start with defaults for this notification type
    defaults = DEFAULT_NOTIFICATION_CHANNELS.get(
        notification_type,
        {"in_app": True, "browser": True, "email": True},
    )
    channels = defaults.copy()

    # Apply user overrides for this notification type
    effective = get_effective_notifications(overrides)
    user_channel_overrides = effective.get("channel_overrides", {})
    if notification_type in user_channel_overrides:
        type_overrides = user_channel_overrides[notification_type]
        for channel, enabled in type_overrides.items():
            if enabled is not None:
                channels[channel] = enabled

    # Apply master switches
    if not effective.get("browser_enabled", True):
        channels["browser"] = False
    if not effective.get("email_enabled", True):
        channels["email"] = False

    return channels
