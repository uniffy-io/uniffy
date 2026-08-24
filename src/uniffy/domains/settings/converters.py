from typing import Any

from uniffy_proto.settings.v1.settings_pb2 import (
    AppearanceSettings as ProtoAppearance,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    EffectiveSettings as ProtoEffectiveSettings,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    KeyboardShortcutsSettings as ProtoKeyboardShortcuts,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    NotificationChannelPreference as ProtoChannelPreference,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    NotificationsSettings as ProtoNotifications,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    SchedulingSettings as ProtoScheduling,
)
from uniffy_proto.settings.v1.settings_pb2 import (
    SettingsProfile as ProtoSettingsProfile,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.settings.settings_profile import SettingsProfile


def profile_to_proto(profile: SettingsProfile) -> ProtoSettingsProfile:
    proto_profile = ProtoSettingsProfile(
        id=str(profile.id),
        user_id=str(profile.user_id),
        name=profile.name,
        is_default=profile.is_default,
        created_at=datetime_to_timestamp(profile.created_at),
        updated_at=datetime_to_timestamp(profile.updated_at),
    )

    if profile.appearance:
        proto_profile.appearance.CopyFrom(appearance_dict_to_proto(profile.appearance))

    if profile.keyboard_shortcuts:
        proto_profile.keyboard_shortcuts.CopyFrom(
            keyboard_shortcuts_dict_to_proto(profile.keyboard_shortcuts)
        )

    if profile.notifications:
        proto_profile.notifications.CopyFrom(notifications_dict_to_proto(profile.notifications))

    if profile.scheduling:
        proto_profile.scheduling.CopyFrom(scheduling_dict_to_proto(profile.scheduling))

    return proto_profile


def scheduling_dict_to_proto(settings: dict[str, Any] | None) -> ProtoScheduling:
    if not settings:
        return ProtoScheduling()

    proto = ProtoScheduling()

    if settings.get("workday_start") is not None:
        proto.workday_start = settings["workday_start"]

    if settings.get("workday_end") is not None:
        proto.workday_end = settings["workday_end"]

    workdays = settings.get("workdays")
    if workdays:
        proto.workdays.extend(workdays)

    return proto


def scheduling_from_proto(proto: ProtoScheduling | None) -> dict[str, Any] | None:
    # Sparse: only explicitly set fields are returned so updates stay PATCH-like.
    # An empty workdays list on the wire means "not set" - the section cannot
    # express zero workdays, which validation forbids anyway.
    if not proto:
        return None

    result: dict[str, Any] = {}

    if proto.HasField("workday_start"):
        result["workday_start"] = proto.workday_start or None

    if proto.HasField("workday_end"):
        result["workday_end"] = proto.workday_end or None

    if proto.workdays:
        result["workdays"] = list(proto.workdays)

    return result if result else None


def appearance_dict_to_proto(settings: dict[str, Any] | None) -> ProtoAppearance:
    if not settings:
        return ProtoAppearance()

    proto = ProtoAppearance()

    if settings.get("theme") is not None:
        proto.theme = settings["theme"]

    if settings.get("accent_color") is not None:
        proto.accent_color = settings["accent_color"]

    if settings.get("font_family") is not None:
        proto.font_family = settings["font_family"]

    if settings.get("sidebar_collapsed") is not None:
        proto.sidebar_collapsed = settings["sidebar_collapsed"]

    if settings.get("compact_mode") is not None:
        proto.compact_mode = settings["compact_mode"]

    if settings.get("default_editor") is not None:
        proto.default_editor = settings["default_editor"]

    if settings.get("mention_display") is not None:
        proto.mention_display = settings["mention_display"]

    if settings.get("markdown_show_preview") is not None:
        proto.markdown_show_preview = settings["markdown_show_preview"]

    if settings.get("markdown_show_line_numbers") is not None:
        proto.markdown_show_line_numbers = settings["markdown_show_line_numbers"]

    if settings.get("timezone") is not None:
        proto.timezone = settings["timezone"]

    if settings.get("week_start") is not None:
        proto.week_start = settings["week_start"]

    return proto


def keyboard_shortcuts_dict_to_proto(settings: dict[str, Any] | None) -> ProtoKeyboardShortcuts:
    if not settings:
        return ProtoKeyboardShortcuts()

    proto = ProtoKeyboardShortcuts()

    bindings = settings.get("bindings", {})
    for action, shortcut in bindings.items():
        proto.bindings[action] = shortcut

    return proto


def notifications_dict_to_proto(settings: dict[str, Any] | None) -> ProtoNotifications:
    if not settings:
        return ProtoNotifications()

    proto = ProtoNotifications()

    if settings.get("browser_enabled") is not None:
        proto.browser_enabled = settings["browser_enabled"]

    if settings.get("email_enabled") is not None:
        proto.email_enabled = settings["email_enabled"]

    if settings.get("sound_enabled") is not None:
        proto.sound_enabled = settings["sound_enabled"]

    if settings.get("email_frequency") is not None:
        proto.email_frequency = settings["email_frequency"]

    if settings.get("email_digest_time") is not None:
        proto.email_digest_time = settings["email_digest_time"]

    if settings.get("quiet_hours_start") is not None:
        proto.quiet_hours_start = settings["quiet_hours_start"]

    if settings.get("quiet_hours_end") is not None:
        proto.quiet_hours_end = settings["quiet_hours_end"]

    if settings.get("toast_enabled") is not None:
        proto.toast_enabled = settings["toast_enabled"]

    channel_overrides = settings.get("channel_overrides", {})
    for notif_type, channels in channel_overrides.items():
        pref = ProtoChannelPreference()
        if channels.get("in_app") is not None:
            pref.in_app = channels["in_app"]
        if channels.get("browser") is not None:
            pref.browser = channels["browser"]
        if channels.get("email") is not None:
            pref.email = channels["email"]
        proto.channel_overrides[notif_type].CopyFrom(pref)

    reminder_intervals = settings.get("default_reminder_intervals")
    if reminder_intervals:
        proto.default_reminder_intervals.extend(reminder_intervals)

    return proto


def effective_settings_to_proto(settings: dict[str, Any]) -> ProtoEffectiveSettings:
    return ProtoEffectiveSettings(
        appearance=appearance_dict_to_proto(settings.get("appearance")),
        keyboard_shortcuts=keyboard_shortcuts_dict_to_proto(settings.get("keyboard_shortcuts")),
        notifications=notifications_dict_to_proto(settings.get("notifications")),
        scheduling=scheduling_dict_to_proto(settings.get("scheduling")),
    )


def appearance_from_proto(proto: ProtoAppearance | None) -> dict[str, Any] | None:
    # Sparse: only explicitly set fields are returned so updates stay PATCH-like.
    if not proto:
        return None

    result: dict[str, Any] = {}

    if proto.HasField("theme"):
        result["theme"] = proto.theme

    if proto.HasField("accent_color"):
        result["accent_color"] = proto.accent_color

    if proto.HasField("font_family"):
        result["font_family"] = proto.font_family

    if proto.HasField("sidebar_collapsed"):
        result["sidebar_collapsed"] = proto.sidebar_collapsed

    if proto.HasField("compact_mode"):
        result["compact_mode"] = proto.compact_mode

    if proto.HasField("default_editor"):
        result["default_editor"] = proto.default_editor

    if proto.HasField("mention_display"):
        result["mention_display"] = proto.mention_display

    if proto.HasField("markdown_show_preview"):
        result["markdown_show_preview"] = proto.markdown_show_preview

    if proto.HasField("markdown_show_line_numbers"):
        result["markdown_show_line_numbers"] = proto.markdown_show_line_numbers

    if proto.HasField("timezone"):
        # Empty string clears the preference back to automatic.
        result["timezone"] = proto.timezone or None

    if proto.HasField("week_start"):
        result["week_start"] = proto.week_start or None

    return result if result else None


def keyboard_shortcuts_from_proto(proto: ProtoKeyboardShortcuts | None) -> dict[str, Any] | None:
    if not proto:
        return None

    if not proto.bindings:
        return None

    return {"bindings": dict(proto.bindings)}


def notifications_from_proto(proto: ProtoNotifications | None) -> dict[str, Any] | None:
    # Sparse: only explicitly set fields are returned so updates stay PATCH-like.
    if not proto:
        return None

    result: dict[str, Any] = {}

    if proto.HasField("browser_enabled"):
        result["browser_enabled"] = proto.browser_enabled

    if proto.HasField("email_enabled"):
        result["email_enabled"] = proto.email_enabled

    if proto.HasField("sound_enabled"):
        result["sound_enabled"] = proto.sound_enabled

    if proto.HasField("email_frequency"):
        result["email_frequency"] = proto.email_frequency

    if proto.HasField("email_digest_time"):
        result["email_digest_time"] = proto.email_digest_time

    if proto.HasField("quiet_hours_start"):
        result["quiet_hours_start"] = proto.quiet_hours_start or None

    if proto.HasField("quiet_hours_end"):
        result["quiet_hours_end"] = proto.quiet_hours_end or None

    if proto.HasField("toast_enabled"):
        result["toast_enabled"] = proto.toast_enabled

    if proto.channel_overrides:
        overrides: dict[str, dict[str, bool]] = {}
        for notif_type, pref in proto.channel_overrides.items():
            channels: dict[str, bool] = {}
            if pref.HasField("in_app"):
                channels["in_app"] = pref.in_app
            if pref.HasField("browser"):
                channels["browser"] = pref.browser
            if pref.HasField("email"):
                channels["email"] = pref.email
            if channels:
                overrides[notif_type] = channels
        if overrides:
            result["channel_overrides"] = overrides

    if proto.default_reminder_intervals:
        result["default_reminder_intervals"] = list(proto.default_reminder_intervals)

    return result if result else None
