"""Resolve whether interruptive notification delivery should be suppressed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.valkey.presence import PRESENCE_STATUS_DND, presence_get_bulk
from uniffy.domains.settings.defaults import get_effective_notifications

_PRESENCE_BATCH_SIZE = 200
_UTC = ZoneInfo("UTC")


@dataclass(frozen=True)
class InterruptiveDeliveryContext:
    timezone: str | None = None
    presence_status: str | None = None


async def load_interruptive_delivery_contexts(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
) -> dict[UUID, InterruptiveDeliveryContext]:
    unique_ids = list(dict.fromkeys(user_ids))
    if not unique_ids:
        return {}

    result = await session.execute(
        select(PeopleProfile.user_id, PeopleProfile.timezone).where(
            PeopleProfile.organization_id == organization_id,
            PeopleProfile.user_id.in_(unique_ids),
        )
    )
    timezones = {row.user_id: row.timezone for row in result.all()}

    presence: dict[str, dict[str, Any]] = {}
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

    settings = get_effective_notifications(notification_overrides)
    start = settings.get("quiet_hours_start")
    end = settings.get("quiet_hours_end")
    if not isinstance(start, str) or not isinstance(end, str) or not start or not end:
        return False

    start_minutes = _parse_clock_minutes(start)
    end_minutes = _parse_clock_minutes(end)
    if start_minutes is None or end_minutes is None or start_minutes == end_minutes:
        return False

    zone = _resolve_zone(context.timezone)
    instant = at or datetime.now(UTC)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    local = instant.astimezone(zone)
    current_minutes = local.hour * 60 + local.minute

    if start_minutes < end_minutes:
        return start_minutes <= current_minutes < end_minutes
    return current_minutes >= start_minutes or current_minutes < end_minutes


def _parse_clock_minutes(value: str) -> int | None:
    parts = value.split(":")
    if len(parts) != 2:  # noqa: PLR2004 -- HH:MM boundary shape
        return None
    try:
        hour, minute = (int(part) for part in parts)
    except ValueError:
        return None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:  # noqa: PLR2004 -- clock bounds
        return None
    if value != f"{hour:02d}:{minute:02d}":
        return None
    return hour * 60 + minute


def _resolve_zone(value: str | None) -> ZoneInfo:
    if not value:
        return _UTC
    try:
        return ZoneInfo(value)
    except ValueError, ZoneInfoNotFoundError:
        return _UTC
