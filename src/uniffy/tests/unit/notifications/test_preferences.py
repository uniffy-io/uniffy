"""Batched notification preference resolution."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.notifications.delivery.base import NotificationChannel
from uniffy.domains.notifications.preferences import (
    get_delivery_preferences_bulk,
    load_notification_overrides_bulk,
)


async def test_bulk_loader_combines_cache_hits_and_one_database_query() -> None:
    cached_user = generate_id()
    loaded_user = generate_id()
    default_user = generate_id()
    session = AsyncMock()
    session.execute.return_value = MagicMock(
        all=MagicMock(
            return_value=[(loaded_user, {"email_frequency": "daily"})]
        )
    )

    with (
        patch(
            "uniffy.domains.notifications.preferences.get_cached_settings_bulk",
            new=AsyncMock(
                return_value=(
                    {cached_user: {"email_enabled": False}},
                    [loaded_user, default_user],
                )
            ),
        ),
        patch(
            "uniffy.domains.notifications.preferences.set_cached_settings_bulk",
            new=AsyncMock(),
        ) as cache_set,
    ):
        resolved = await load_notification_overrides_bulk(
            session,
            [cached_user, loaded_user, default_user],
        )

    assert resolved == {
        cached_user: {"email_enabled": False},
        loaded_user: {"email_frequency": "daily"},
        default_user: None,
    }
    session.execute.assert_awaited_once()
    cache_set.assert_awaited_once_with({
        loaded_user: {"email_frequency": "daily"},
        default_user: None,
    })


async def test_bulk_delivery_preferences_apply_type_and_master_switches() -> None:
    email_user = generate_id()
    app_only_user = generate_id()
    session = AsyncMock()

    with patch(
        "uniffy.domains.notifications.preferences.load_notification_overrides_bulk",
        new=AsyncMock(
            return_value={
                email_user: None,
                app_only_user: {"browser_enabled": False, "email_enabled": False},
            }
        ),
    ):
        preferences = await get_delivery_preferences_bulk(
            session,
            [email_user, app_only_user],
            NotificationType.CHAT_MENTION,
        )

    assert preferences[email_user][0] == {
        NotificationChannel.IN_APP,
        NotificationChannel.BROWSER,
        NotificationChannel.EMAIL,
    }
    assert preferences[app_only_user][0] == {NotificationChannel.IN_APP}
