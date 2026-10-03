"""Calendar policy reaches the members service only through registered guards."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.content.registry import find_access_mode_guard, find_transfer_guard
from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.scheduling.calendar.calendars.guards import (
    guard_calendar_access_mode,
    guard_calendar_transfer,
    guard_event_access_mode,
)
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content


def _calendar(*, is_default: bool) -> Calendar:
    return Calendar(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Mine",
        is_default=is_default,
    )


def test_registration_binds_every_guard() -> None:
    register_calendar_content()

    assert find_access_mode_guard(ContentType.CALENDAR) is guard_calendar_access_mode
    assert find_access_mode_guard(ContentType.CALENDAR_EVENT) is guard_event_access_mode
    assert find_transfer_guard(ContentType.CALENDAR) is guard_calendar_transfer


async def test_a_default_calendar_is_not_transferable() -> None:
    with pytest.raises(ValidationError):
        await guard_calendar_transfer(
            MagicMock(), generate_id(), _calendar(is_default=True), generate_id()
        )


async def test_another_calendar_is_transferable() -> None:
    await guard_calendar_transfer(
        MagicMock(), generate_id(), _calendar(is_default=False), generate_id()
    )


@pytest.mark.parametrize("mode", [AccessMode.OWNER_ONLY, AccessMode.EXPLICIT_MEMBERS, None])
async def test_events_accept_every_mode_but_org_wide(mode: AccessMode | None) -> None:
    await guard_event_access_mode(MagicMock(), generate_id(), generate_id(), object(), mode, None)


async def test_events_refuse_org_wide() -> None:
    with pytest.raises(ValidationError, match="invite-only"):
        await guard_event_access_mode(
            MagicMock(),
            generate_id(),
            generate_id(),
            object(),
            AccessMode.OPEN_TO_ORG,
            ContentRole.VIEWER,
        )


async def test_clearing_a_calendar_to_inherit_counts_as_opening_it() -> None:
    """The org default is read live, so an admin opening it later would open this one too."""
    session = MagicMock()
    with (
        patch(
            "uniffy.domains.scheduling.calendar.calendars.guards.require_can_open_calendar_to_org",
            AsyncMock(),
        ) as gate,
        patch(
            "uniffy.domains.scheduling.calendar.calendars.guards.resolve_content_defaults",
            AsyncMock(return_value=(AccessMode.OWNER_ONLY, None)),
        ),
    ):
        await guard_calendar_access_mode(
            session, generate_id(), generate_id(), object(), None, None
        )

    gate.assert_awaited_once()


async def test_a_private_mode_needs_no_org_wide_right() -> None:
    with (
        patch(
            "uniffy.domains.scheduling.calendar.calendars.guards.require_can_open_calendar_to_org",
            AsyncMock(),
        ) as gate,
        patch(
            "uniffy.domains.scheduling.calendar.calendars.guards.resolve_content_defaults",
            AsyncMock(return_value=(AccessMode.OPEN_TO_ORG, ContentRole.VIEWER)),
        ),
    ):
        await guard_calendar_access_mode(
            MagicMock(), generate_id(), generate_id(), object(), AccessMode.EXPLICIT_MEMBERS, None
        )

    gate.assert_not_awaited()
