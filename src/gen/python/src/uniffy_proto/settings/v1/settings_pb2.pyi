import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CreateProfileRequest(_message.Message):
    __slots__ = ("name", "appearance", "keyboard_shortcuts", "notifications", "is_default")
    NAME_FIELD_NUMBER: _ClassVar[int]
    APPEARANCE_FIELD_NUMBER: _ClassVar[int]
    KEYBOARD_SHORTCUTS_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATIONS_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    name: str
    appearance: AppearanceSettings
    keyboard_shortcuts: KeyboardShortcutsSettings
    notifications: NotificationsSettings
    is_default: bool
    def __init__(self, name: _Optional[str] = ..., appearance: _Optional[_Union[AppearanceSettings, _Mapping]] = ..., keyboard_shortcuts: _Optional[_Union[KeyboardShortcutsSettings, _Mapping]] = ..., notifications: _Optional[_Union[NotificationsSettings, _Mapping]] = ..., is_default: _Optional[bool] = ...) -> None: ...

class GetProfileRequest(_message.Message):
    __slots__ = ("profile_id",)
    PROFILE_ID_FIELD_NUMBER: _ClassVar[int]
    profile_id: str
    def __init__(self, profile_id: _Optional[str] = ...) -> None: ...

class UpdateProfileRequest(_message.Message):
    __slots__ = ("profile_id", "name", "appearance", "keyboard_shortcuts", "notifications", "is_default")
    PROFILE_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    APPEARANCE_FIELD_NUMBER: _ClassVar[int]
    KEYBOARD_SHORTCUTS_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATIONS_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    profile_id: str
    name: str
    appearance: AppearanceSettings
    keyboard_shortcuts: KeyboardShortcutsSettings
    notifications: NotificationsSettings
    is_default: bool
    def __init__(self, profile_id: _Optional[str] = ..., name: _Optional[str] = ..., appearance: _Optional[_Union[AppearanceSettings, _Mapping]] = ..., keyboard_shortcuts: _Optional[_Union[KeyboardShortcutsSettings, _Mapping]] = ..., notifications: _Optional[_Union[NotificationsSettings, _Mapping]] = ..., is_default: _Optional[bool] = ...) -> None: ...

class DeleteProfileRequest(_message.Message):
    __slots__ = ("profile_id",)
    PROFILE_ID_FIELD_NUMBER: _ClassVar[int]
    profile_id: str
    def __init__(self, profile_id: _Optional[str] = ...) -> None: ...

class DeleteProfileResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class CreateProfileResponse(_message.Message):
    __slots__ = ("profile",)
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    profile: SettingsProfile
    def __init__(self, profile: _Optional[_Union[SettingsProfile, _Mapping]] = ...) -> None: ...

class GetProfileResponse(_message.Message):
    __slots__ = ("profile",)
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    profile: SettingsProfile
    def __init__(self, profile: _Optional[_Union[SettingsProfile, _Mapping]] = ...) -> None: ...

class UpdateProfileResponse(_message.Message):
    __slots__ = ("profile",)
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    profile: SettingsProfile
    def __init__(self, profile: _Optional[_Union[SettingsProfile, _Mapping]] = ...) -> None: ...

class SetDefaultProfileResponse(_message.Message):
    __slots__ = ("profile",)
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    profile: SettingsProfile
    def __init__(self, profile: _Optional[_Union[SettingsProfile, _Mapping]] = ...) -> None: ...

class ListProfilesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListProfilesResponse(_message.Message):
    __slots__ = ("profiles", "total_count")
    PROFILES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    profiles: _containers.RepeatedCompositeFieldContainer[SettingsProfile]
    total_count: int
    def __init__(self, profiles: _Optional[_Iterable[_Union[SettingsProfile, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class GetEffectiveSettingsRequest(_message.Message):
    __slots__ = ("profile_id",)
    PROFILE_ID_FIELD_NUMBER: _ClassVar[int]
    profile_id: str
    def __init__(self, profile_id: _Optional[str] = ...) -> None: ...

class GetEffectiveSettingsResponse(_message.Message):
    __slots__ = ("profile", "effective_settings")
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    profile: SettingsProfile
    effective_settings: EffectiveSettings
    def __init__(self, profile: _Optional[_Union[SettingsProfile, _Mapping]] = ..., effective_settings: _Optional[_Union[EffectiveSettings, _Mapping]] = ...) -> None: ...

class GetSettingsSchemaRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetSettingsSchemaResponse(_message.Message):
    __slots__ = ("appearance_defaults", "keyboard_shortcuts_defaults", "notifications_defaults")
    APPEARANCE_DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    KEYBOARD_SHORTCUTS_DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATIONS_DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    appearance_defaults: AppearanceSettings
    keyboard_shortcuts_defaults: KeyboardShortcutsSettings
    notifications_defaults: NotificationsSettings
    def __init__(self, appearance_defaults: _Optional[_Union[AppearanceSettings, _Mapping]] = ..., keyboard_shortcuts_defaults: _Optional[_Union[KeyboardShortcutsSettings, _Mapping]] = ..., notifications_defaults: _Optional[_Union[NotificationsSettings, _Mapping]] = ...) -> None: ...

class SetDefaultProfileRequest(_message.Message):
    __slots__ = ("profile_id",)
    PROFILE_ID_FIELD_NUMBER: _ClassVar[int]
    profile_id: str
    def __init__(self, profile_id: _Optional[str] = ...) -> None: ...

class SettingsProfile(_message.Message):
    __slots__ = ("id", "user_id", "name", "appearance", "keyboard_shortcuts", "notifications", "is_default", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    APPEARANCE_FIELD_NUMBER: _ClassVar[int]
    KEYBOARD_SHORTCUTS_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATIONS_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    name: str
    appearance: AppearanceSettings
    keyboard_shortcuts: KeyboardShortcutsSettings
    notifications: NotificationsSettings
    is_default: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., name: _Optional[str] = ..., appearance: _Optional[_Union[AppearanceSettings, _Mapping]] = ..., keyboard_shortcuts: _Optional[_Union[KeyboardShortcutsSettings, _Mapping]] = ..., notifications: _Optional[_Union[NotificationsSettings, _Mapping]] = ..., is_default: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class EffectiveSettings(_message.Message):
    __slots__ = ("appearance", "keyboard_shortcuts", "notifications")
    APPEARANCE_FIELD_NUMBER: _ClassVar[int]
    KEYBOARD_SHORTCUTS_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATIONS_FIELD_NUMBER: _ClassVar[int]
    appearance: AppearanceSettings
    keyboard_shortcuts: KeyboardShortcutsSettings
    notifications: NotificationsSettings
    def __init__(self, appearance: _Optional[_Union[AppearanceSettings, _Mapping]] = ..., keyboard_shortcuts: _Optional[_Union[KeyboardShortcutsSettings, _Mapping]] = ..., notifications: _Optional[_Union[NotificationsSettings, _Mapping]] = ...) -> None: ...

class AppearanceSettings(_message.Message):
    __slots__ = ("theme", "accent_color", "font_family", "sidebar_collapsed", "compact_mode", "default_editor", "mention_display")
    THEME_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    SIDEBAR_COLLAPSED_FIELD_NUMBER: _ClassVar[int]
    COMPACT_MODE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_EDITOR_FIELD_NUMBER: _ClassVar[int]
    MENTION_DISPLAY_FIELD_NUMBER: _ClassVar[int]
    theme: str
    accent_color: str
    font_family: str
    sidebar_collapsed: bool
    compact_mode: bool
    default_editor: str
    mention_display: str
    def __init__(self, theme: _Optional[str] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., sidebar_collapsed: _Optional[bool] = ..., compact_mode: _Optional[bool] = ..., default_editor: _Optional[str] = ..., mention_display: _Optional[str] = ...) -> None: ...

class KeyboardShortcutsSettings(_message.Message):
    __slots__ = ("bindings",)
    class BindingsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    BINDINGS_FIELD_NUMBER: _ClassVar[int]
    bindings: _containers.ScalarMap[str, str]
    def __init__(self, bindings: _Optional[_Mapping[str, str]] = ...) -> None: ...

class NotificationsSettings(_message.Message):
    __slots__ = ("browser_enabled", "email_enabled", "sound_enabled", "email_frequency", "quiet_hours_start", "quiet_hours_end", "channel_overrides", "default_reminder_intervals", "toast_enabled")
    class ChannelOverridesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: NotificationChannelPreference
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[NotificationChannelPreference, _Mapping]] = ...) -> None: ...
    BROWSER_ENABLED_FIELD_NUMBER: _ClassVar[int]
    EMAIL_ENABLED_FIELD_NUMBER: _ClassVar[int]
    SOUND_ENABLED_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FREQUENCY_FIELD_NUMBER: _ClassVar[int]
    QUIET_HOURS_START_FIELD_NUMBER: _ClassVar[int]
    QUIET_HOURS_END_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_OVERRIDES_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_REMINDER_INTERVALS_FIELD_NUMBER: _ClassVar[int]
    TOAST_ENABLED_FIELD_NUMBER: _ClassVar[int]
    browser_enabled: bool
    email_enabled: bool
    sound_enabled: bool
    email_frequency: str
    quiet_hours_start: str
    quiet_hours_end: str
    channel_overrides: _containers.MessageMap[str, NotificationChannelPreference]
    default_reminder_intervals: _containers.RepeatedScalarFieldContainer[int]
    toast_enabled: bool
    def __init__(self, browser_enabled: _Optional[bool] = ..., email_enabled: _Optional[bool] = ..., sound_enabled: _Optional[bool] = ..., email_frequency: _Optional[str] = ..., quiet_hours_start: _Optional[str] = ..., quiet_hours_end: _Optional[str] = ..., channel_overrides: _Optional[_Mapping[str, NotificationChannelPreference]] = ..., default_reminder_intervals: _Optional[_Iterable[int]] = ..., toast_enabled: _Optional[bool] = ...) -> None: ...

class NotificationChannelPreference(_message.Message):
    __slots__ = ("in_app", "browser", "email")
    IN_APP_FIELD_NUMBER: _ClassVar[int]
    BROWSER_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    in_app: bool
    browser: bool
    email: bool
    def __init__(self, in_app: _Optional[bool] = ..., browser: _Optional[bool] = ..., email: _Optional[bool] = ...) -> None: ...
