import pytest

from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.settings.preferences import (
    UserCalendarPreferences,
    get_user_calendar_preferences,
    get_user_timezone,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_calendar_preferences_use_only_the_callers_default_profile(session, env) -> None:
    assert await get_user_calendar_preferences(session, env.admin_id) == UserCalendarPreferences(
        None, 0
    )
    profiles = [
        SettingsProfile(
            user_id=env.admin_id,
            name="Default",
            is_default=True,
            appearance={"timezone": "Asia/Tokyo", "week_start": "sunday"},
        ),
        SettingsProfile(
            user_id=env.admin_id,
            name="Other",
            is_default=False,
            appearance={"timezone": "UTC", "week_start": "monday"},
        ),
        SettingsProfile(
            user_id=env.member_id,
            name="Default",
            is_default=True,
            appearance={"timezone": "America/Los_Angeles", "week_start": "saturday"},
        ),
    ]
    session.add_all(profiles)
    await session.flush()
    try:
        assert await get_user_calendar_preferences(session, env.admin_id) == UserCalendarPreferences(
            "Asia/Tokyo", 6
        )
        assert await get_user_calendar_preferences(
            session, env.member_id
        ) == UserCalendarPreferences("America/Los_Angeles", 5)
        assert await get_user_timezone(session, env.admin_id) == "Asia/Tokyo"
    finally:
        await session.rollback()
