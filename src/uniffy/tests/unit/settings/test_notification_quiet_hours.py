"""Validation and clearing behavior for quiet-hours settings."""

from unittest.mock import AsyncMock

import pytest
from uniffy_proto.settings.v1.settings_pb2 import NotificationsSettings

from uniffy.core.errors import ValidationError
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.core.types import generate_id
from uniffy.domains.settings.converters import notifications_from_proto
from uniffy.domains.settings.operations import SettingsOperations, _validate_notifications


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("09:00", "17:00"),
        ("22:00", "08:00"),
    ],
)
def test_validate_accepts_same_day_and_overnight_windows(start: str, end: str) -> None:
    _validate_notifications({"quiet_hours_start": start, "quiet_hours_end": end})


def test_validate_accepts_disabled_quiet_hours() -> None:
    _validate_notifications(None)
    _validate_notifications({})
    _validate_notifications({"quiet_hours_start": None, "quiet_hours_end": None})


@pytest.mark.parametrize(
    "settings",
    [
        {"quiet_hours_start": "22:00"},
        {"quiet_hours_end": "08:00"},
        {"quiet_hours_start": "9:00", "quiet_hours_end": "17:00"},
        {"quiet_hours_start": "24:00", "quiet_hours_end": "08:00"},
        {"quiet_hours_start": "22:00", "quiet_hours_end": "22:00"},
    ],
)
def test_validate_rejects_incomplete_or_invalid_windows(settings: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        _validate_notifications(settings)


def test_empty_proto_values_clear_both_overrides() -> None:
    proto = NotificationsSettings(quiet_hours_start="", quiet_hours_end="")

    assert notifications_from_proto(proto) == {
        "quiet_hours_start": None,
        "quiet_hours_end": None,
    }


async def test_sparse_profile_update_validates_the_merged_window() -> None:
    session = AsyncMock()
    operations = SettingsOperations(session)
    profile = SettingsProfile(
        user_id=generate_id(),
        name="Default",
        notifications=None,
        is_default=True,
    )
    operations.get_profile = AsyncMock(return_value=profile)

    with pytest.raises(ValidationError):
        await operations.update_profile(
            profile.user_id,
            profile.id,
            notifications={"quiet_hours_start": "22:00"},
        )

    session.commit.assert_not_awaited()
