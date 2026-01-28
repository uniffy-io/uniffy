"""Settings domain package.

Provides user settings profile management with sparse JSONB storage.
Users can create named profiles (Default, Work, Home) with customizations,
and only user overrides are stored - code defaults fill in the rest.
"""

from uniffy.domains.settings.defaults import (
    APPEARANCE_DEFAULTS,
    DEFAULT_KEYBOARD_SHORTCUTS,
    NOTIFICATIONS_DEFAULTS,
    get_effective_appearance,
    get_effective_keyboard_shortcuts,
    get_effective_notifications,
)
from uniffy.domains.settings.handlers import SettingsHandlers
from uniffy.domains.settings.operations import SettingsOperations
from uniffy.domains.settings.service import SettingsServiceImpl

__all__ = [
    "SettingsHandlers",
    "SettingsOperations",
    "SettingsServiceImpl",
    "APPEARANCE_DEFAULTS",
    "DEFAULT_KEYBOARD_SHORTCUTS",
    "NOTIFICATIONS_DEFAULTS",
    "get_effective_appearance",
    "get_effective_keyboard_shortcuts",
    "get_effective_notifications",
]
