"""Resolve whether interruptive notification delivery should be suppressed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.valkey.presence import PRESENCE_STATUS_DND, presence_get_bulk
from uniffy.domains.notifications.delivery.timing import quiet_hours_end_at

_PRESENCE_BATCH_SIZE = 200
_TIMEZONE_BATCH_SIZE = 500


@dataclass(frozen=True)
class InterruptiveDeliveryContext:
    timezone: str | None = None
    presence_status: str | None = None


async def load_interruptive_delivery_contexts(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    *,
    include_presence: bool = True,
) -> dict[UUID, InterruptiveDeliveryContext]:
    unique_ids = list(dict.fromkeys(user_ids))
    if not unique_ids:
        return {}

    timezones: dict[UUID, str | None] = {}
    for offset in range(0, len(unique_ids), _TIMEZONE_BATCH_SIZE):
        chunk = unique_ids[offset : offset + _TIMEZONE_BATCH_SIZE]
        result = await session.execute(
            select(SettingsProfile.user_id, SettingsProfile.appearance).where(
                SettingsProfile.user_id.in_(chunk),
                SettingsProfile.is_default.is_(True),
            )
        )
        timezones.update({
            row.user_id: (row.appearance or {}).get("timezone") for row in result.all()
        })

    presence: dict[str, dict[str, Any]] = {}
    if include_presence:
        for offset in range(0, len(unique_ids), _PRESENCE_BATCH_SIZE):
            chunk = unique_ids[offset : offset + _PRESENCE_BATCH_SIZE]
            presence.update(await presence_get_bulk(organization_id, chunk))

    return {
        user_id: InterruptiveDeliveryContext(
            timezone=timezones.get(user_id),
            presence_status=presence.get(str(user_id), {}).get("status"),
        )
        for user_id in unique_ids
    }


def should_suppress_interruptive_delivery(
    notification_overrides: dict[str, Any] | None,
    context: InterruptiveDeliveryContext,
    *,
    at: datetime | None = None,
) -> bool:
    if context.presence_status == PRESENCE_STATUS_DND:
        return True
    return (
        quiet_hours_end_at(
            notification_overrides,
            context.timezone,
            at=at,
        )
        is not None
    )
