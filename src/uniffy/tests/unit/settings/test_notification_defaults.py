from uniffy.core.types import NotificationType
from uniffy.domains.settings.defaults import (
    DEFAULT_NOTIFICATION_CHANNELS,
    get_effective_notification_channels,
)


def test_notification_channel_defaults_cover_every_notification_type() -> None:
    assert set(DEFAULT_NOTIFICATION_CHANNELS) == set(NotificationType)


def test_access_request_notification_defaults() -> None:
    assert DEFAULT_NOTIFICATION_CHANNELS[NotificationType.ACCESS_REQUESTED] == {
        "in_app": True,
        "browser": True,
        "email": True,
    }
    assert DEFAULT_NOTIFICATION_CHANNELS[NotificationType.ACCESS_REQUEST_DENIED] == {
        "in_app": True,
        "browser": True,
        "email": False,
    }


def test_notification_channel_overrides_use_serialized_type_keys() -> None:
    channels = get_effective_notification_channels(
        NotificationType.CHAT_MENTION,
        {
            "channel_overrides": {
                NotificationType.CHAT_MENTION.value: {
                    "browser": False,
                    "email": True,
                }
            }
        },
    )

    assert channels == {"in_app": True, "browser": False, "email": True}


def test_notification_master_switches_override_type_preferences() -> None:
    channels = get_effective_notification_channels(
        NotificationType.CONTENT_SHARED,
        {"browser_enabled": False, "email_enabled": False},
    )

    assert channels == {"in_app": True, "browser": False, "email": False}
