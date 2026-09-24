"""Read-only calendar preferences for callers outside settings."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.settings.defaults import APPEARANCE_DEFAULTS

WEEK_START_WEEKDAYS = {"monday": 0, "saturday": 5, "sunday": 6}


@dataclass(frozen=True)
class UserCalendarPreferences:
    # None means the client's own zone.
    timezone: str | None
    # Weekday the week starts on, Monday being 0.
    week_start: int


async def get_user_calendar_preferences(
    session: AsyncSession, user_id: UUID
) -> UserCalendarPreferences:
    result = await session.execute(
        select(SettingsProfile.appearance).where(
            SettingsProfile.user_id == user_id,
            SettingsProfile.is_default.is_(True),
        )
    )
    appearance = result.scalar_one_or_none() or {}
    return UserCalendarPreferences(
        timezone=appearance.get("timezone") or None,
        week_start=WEEK_START_WEEKDAYS.get(
            appearance.get("week_start") or APPEARANCE_DEFAULTS.week_start, 0
        ),
    )


async def get_user_timezone(session: AsyncSession, user_id: UUID) -> str | None:
    return (await get_user_calendar_preferences(session, user_id)).timezone
