"""Required minutes: the policy's daily requirement over a person's workdays, minus holidays."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.settings.defaults import SCHEDULING_DEFAULTS, WORKDAY_NAMES


def required_minutes_on(day: date, policy: ResolvedTimePolicy, workdays: tuple[str, ...]) -> int:
    if day.isoformat() in policy.holidays:
        return 0
    if WORKDAY_NAMES[day.weekday()] not in workdays:
        return 0
    return policy.required_minutes_per_day


def required_minutes_between(
    start: date, end: date, policy: ResolvedTimePolicy, workdays: tuple[str, ...]
) -> int:
    total = 0
    cursor = start
    while cursor <= end:
        total += required_minutes_on(cursor, policy, workdays)
        cursor += timedelta(days=1)
    return total


async def workdays_for_users(
    session: AsyncSession, user_ids: list[UUID]
) -> dict[UUID, tuple[str, ...]]:
    """Each person's workdays from their default settings profile, else the scheduling default."""
    workdays = {user_id: SCHEDULING_DEFAULTS.workdays for user_id in user_ids}
    if not user_ids:
        return workdays
    result = await session.execute(
        select(SettingsProfile.user_id, SettingsProfile.scheduling).where(
            SettingsProfile.user_id.in_(user_ids),
            SettingsProfile.is_default.is_(True),
        )
    )
    for user_id, scheduling in result.all():
        configured = (scheduling or {}).get("workdays")
        if isinstance(configured, list) and configured:
            workdays[user_id] = tuple(str(day) for day in configured)
    return workdays
