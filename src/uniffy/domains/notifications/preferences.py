"""Effective notification delivery preferences."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.types import NotificationType
from uniffy.domains.notifications.cache import (
    get_cached_settings_bulk,
    set_cached_settings_bulk,
)
from uniffy.domains.notifications.delivery.base import NotificationChannel
from uniffy.domains.settings.defaults import (
    EmailFrequency,
    get_effective_notification_channels,
    get_effective_notifications,
)

_PREFERENCE_BATCH_SIZE = 500


async def load_notification_overrides(
    session: AsyncSession,
    user_id: UUID,
) -> dict[str, Any] | None:
    return (await load_notification_overrides_bulk(session, [user_id]))[user_id]


async def load_notification_overrides_bulk(
    session: AsyncSession,
    user_ids: list[UUID],
) -> dict[UUID, dict[str, Any] | None]:
    unique_ids = list(dict.fromkeys(user_ids))
    resolved: dict[UUID, dict[str, Any] | None] = {}
    for offset in range(0, len(unique_ids), _PREFERENCE_BATCH_SIZE):
        chunk = unique_ids[offset : offset + _PREFERENCE_BATCH_SIZE]
        hits, misses = await get_cached_settings_bulk(chunk)
        resolved.update(hits)
        if not misses:
            continue
        rows = (
            await session.execute(
                select(SettingsProfile.user_id, SettingsProfile.notifications).where(
                    SettingsProfile.user_id.in_(misses),
                    SettingsProfile.is_default.is_(True),
                )
            )
        ).all()
        loaded = {user_id: notifications for user_id, notifications in rows}
        missed_values = {user_id: loaded.get(user_id) for user_id in misses}
        resolved.update(missed_values)
        await set_cached_settings_bulk(missed_values)
    return resolved


async def get_delivery_preferences(
    session: AsyncSession,
    user_id: UUID,
    notification_type: NotificationType,
) -> tuple[set[NotificationChannel], dict[str, Any] | None]:
    overrides = await load_notification_overrides(session, user_id)
    effective = get_effective_notification_channels(notification_type, overrides)
    channels = {channel for channel in NotificationChannel if effective.get(channel.value, False)}
    return channels, overrides


async def get_delivery_preferences_bulk(
    session: AsyncSession,
    user_ids: list[UUID],
    notification_type: NotificationType,
) -> dict[UUID, tuple[set[NotificationChannel], dict[str, Any] | None]]:
    overrides_by_user = await load_notification_overrides_bulk(session, user_ids)
    preferences: dict[
        UUID,
        tuple[set[NotificationChannel], dict[str, Any] | None],
    ] = {}
    for user_id, overrides in overrides_by_user.items():
        effective = get_effective_notification_channels(notification_type, overrides)
        channels = {
            channel for channel in NotificationChannel if effective.get(channel.value, False)
        }
        preferences[user_id] = channels, overrides
    return preferences


def resolve_email_frequency(overrides: dict[str, Any] | None) -> EmailFrequency:
    value = get_effective_notifications(overrides).get("email_frequency")
    try:
        return EmailFrequency(value)
    except ValueError, TypeError:
        return EmailFrequency.INSTANT
