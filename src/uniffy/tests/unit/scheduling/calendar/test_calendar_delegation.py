"""Pure rules of calendar delegation: the role it confers, its policy, and its wire mapping."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from uniffy_proto.cal.v1.calendar_pb import CalendarDelegationLevel as ProtoDelegationLevel
from uniffy_proto.cal.v1.calendar_pb import CalendarListSection as ProtoCalendarListSection

from uniffy.core.auth.permissions.calendar_delegation import DELEGABLE_CALENDAR_TYPES
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegationLevel
from uniffy.core.types import AccessMode, CalendarType, ContentRole, ContentType, generate_id
from uniffy.domains.permissions.members import ADMIN_RESTRICTABLE_TYPES, ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.converters import (
    DELEGATION_LEVEL_FROM_PROTO,
    DELEGATION_LEVEL_TO_PROTO,
    calendar_to_proto,
)
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarListing, CalendarSection
from uniffy.domains.scheduling.calendar.delegation.access import (
    DELEGATED_CALENDAR_ROLE,
    delegated_event_role,
    is_delegable,
)
from uniffy.domains.scheduling.calendar.delegation.operations import CalendarDelegationOperations
from uniffy.domains.scheduling.calendar.policy import (
    DEFAULT_DELEGATORS,
    CalendarPolicyAudience,
    resolve_calendar_policy,
)

EVENTS = CalendarDelegationLevel.EVENTS
FULL = CalendarDelegationLevel.EVENTS_AND_PRIVATE


class TestDelegatedEventRole:
    def test_no_delegation_confers_nothing(self) -> None:
        assert (
            delegated_event_role(
                None, generate_id(), generate_id(), private=False, is_attendee=False
            )
            is None
        )

    @pytest.mark.parametrize("level", [EVENTS, FULL])
    def test_a_standard_event_is_editable_at_either_level(self, level) -> None:
        role = delegated_event_role(
            level, generate_id(), generate_id(), private=False, is_attendee=False
        )
        assert role is ContentRole.EDITOR is DELEGATED_CALENDAR_ROLE

    def test_a_private_event_is_busy_only_below_the_full_level(self) -> None:
        assert (
            delegated_event_role(
                EVENTS, generate_id(), generate_id(), private=True, is_attendee=False
            )
            is ContentRole.VIEWER
        )
        assert (
            delegated_event_role(FULL, generate_id(), generate_id(), private=True, is_attendee=False)
            is ContentRole.EDITOR
        )

    def test_a_delegate_who_attends_or_organizes_is_not_capped(self) -> None:
        viewer = generate_id()
        assert (
            delegated_event_role(EVENTS, generate_id(), viewer, private=True, is_attendee=True)
            is ContentRole.EDITOR
        )
        assert (
            delegated_event_role(EVENTS, viewer, viewer, private=True, is_attendee=False)
            is ContentRole.EDITOR
        )

    def test_delegation_never_reaches_admin_or_owner(self) -> None:
        for level in CalendarDelegationLevel:
            role = delegated_event_role(
                level, generate_id(), generate_id(), private=False, is_attendee=True
            )
            assert role not in (ContentRole.ADMIN, ContentRole.OWNER)


def test_only_personal_and_work_calendars_are_delegable() -> None:
    assert set(DELEGABLE_CALENDAR_TYPES) == {CalendarType.PERSONAL, CalendarType.WORK}
    assert not is_delegable(CalendarType.TEAM)
    assert not is_delegable(CalendarType.SHARED)


class TestPolicy:
    async def test_delegators_default_to_everyone_on_a_fresh_org(self) -> None:
        with patch("uniffy.domains.scheduling.calendar.policy.OrgSettingsOperations") as settings:
            settings.return_value.get_namespace = AsyncMock(return_value={})
            policy = await resolve_calendar_policy(MagicMock(), generate_id())
        assert policy.delegators is CalendarPolicyAudience.EVERYONE is DEFAULT_DELEGATORS

    async def test_a_malformed_value_falls_back_to_the_default(self) -> None:
        row = MagicMock(value={"delegators": "nonsense"})
        with patch("uniffy.domains.scheduling.calendar.policy.OrgSettingsOperations") as settings:
            settings.return_value.get_namespace = AsyncMock(return_value={"policy": row})
            policy = await resolve_calendar_policy(MagicMock(), generate_id())
        assert policy.delegators is DEFAULT_DELEGATORS


class TestWire:
    def test_levels_round_trip(self) -> None:
        for level in CalendarDelegationLevel:
            assert DELEGATION_LEVEL_FROM_PROTO[DELEGATION_LEVEL_TO_PROTO[level]] is level
        assert ProtoDelegationLevel.UNSPECIFIED not in DELEGATION_LEVEL_FROM_PROTO

    def test_a_delegated_listing_carries_its_section_and_level(self) -> None:
        calendar = Calendar(
            id=generate_id(),
            organization_id=generate_id(),
            owner_id=generate_id(),
            name="Mine",
            access_mode=AccessMode.OWNER_ONLY,
        )
        message = calendar_to_proto(
            CalendarListing(calendar, CalendarSection.DELEGATED, False, EVENTS),
            ContentRole.EDITOR,
        )
        assert message.section == ProtoCalendarListSection.DELEGATED
        assert message.delegation_level == ProtoDelegationLevel.EVENTS


class TestGrantValidation:
    async def test_self_delegation_is_refused_before_any_write(self) -> None:
        session = MagicMock()
        user_id = generate_id()
        with patch(
            "uniffy.domains.scheduling.calendar.delegation.operations.get_active_membership",
            AsyncMock(return_value=object()),
        ):
            with pytest.raises(ValidationError):
                await CalendarDelegationOperations(session).grant(
                    user_id, generate_id(), user_id, EVENTS
                )
        session.add.assert_not_called()


class TestAdminRestriction:
    def test_only_calendars_are_restrictable(self) -> None:
        assert ADMIN_RESTRICTABLE_TYPES == frozenset({ContentType.CALENDAR})

    @pytest.mark.parametrize(
        "content_type", [ct for ct in ContentType if ct not in ADMIN_RESTRICTABLE_TYPES]
    )
    async def test_every_other_type_is_refused_before_any_read(self, content_type) -> None:
        session = MagicMock()
        session.execute = AsyncMock()
        with pytest.raises(PermissionDeniedError):
            await ContentMembersOperations(session, MagicMock()).stage_admin_restriction(
                generate_id(), generate_id(), content_type, generate_id()
            )
        session.execute.assert_not_called()
