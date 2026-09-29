"""The organization decides who may create team calendars and open calendars to everyone.

Asserted on rows: which calendars exist and with what access mode after each attempt,
and the policy and audit rows an update leaves behind.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.search import SearchIndexer
from uniffy.core.types import AccessMode, CalendarType, ContentRole, ContentType, DomainType
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.policy import (
    CalendarPolicyAudience,
    get_calendar_policy_view,
    resolve_calendar_policy,
    update_calendar_policy,
)
from uniffy.domains.scheduling.calendar.queries import ensure_default_calendar

pytestmark = pytest.mark.asyncio(loop_scope="session")

ADMINS = CalendarPolicyAudience.ADMINS
EVERYONE = CalendarPolicyAudience.EVERYONE


def _operations(session) -> CalendarOperations:
    return CalendarOperations(session, AsyncMock(spec=SearchIndexer))


def _members(session) -> ContentMembersOperations:
    return ContentMembersOperations(session, AsyncMock(spec=SearchIndexer))


async def _restrict(session, access, *, team=ADMINS, org_wide=ADMINS) -> None:
    await update_calendar_policy(
        session,
        access.owner_id,
        access.org_id,
        team_calendar_creators=team,
        org_wide_calendar_sharers=org_wide,
    )


async def _create(session, access, user_id, **fields) -> Calendar:
    return await _operations(session).create_calendar(
        user_id=user_id,
        organization_id=access.org_id,
        name=fields.pop("name", "Team"),
        color="#3b82f6",
        **fields,
    )


async def _calendars_named(session, access, name) -> int:
    return await session.scalar(
        select(func.count())
        .select_from(Calendar)
        .where(Calendar.organization_id == access.org_id, Calendar.name == name)
    )


async def _grant_calendar_admin(session, access, user_id) -> None:
    session.add(
        DomainAdmin(
            user_id=user_id,
            organization_id=access.org_id,
            domain=DomainType.CALENDAR,
            granted_by=access.owner_id,
        )
    )
    await session.commit()


class TestDefaults:
    async def test_every_member_may_create_and_open_a_team_calendar(self, session, access) -> None:
        calendar = await _create(
            session,
            access,
            access.member_id,
            calendar_type=CalendarType.TEAM,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

        assert (calendar.calendar_type, calendar.access_mode) == (
            CalendarType.TEAM,
            AccessMode.OPEN_TO_ORG,
        )
        view = await get_calendar_policy_view(session, access.member_id, access.org_id)
        assert view.can_create_team_calendars and view.can_share_calendars_org_wide


class TestAdminsOnly:
    async def test_a_member_cannot_create_a_team_calendar(self, session, access) -> None:
        await _restrict(session, access)

        with pytest.raises(PermissionDeniedError):
            await _create(
                session, access, access.member_id, name="refused", calendar_type=CalendarType.TEAM
            )
        await session.rollback()

        assert await _calendars_named(session, access, "refused") == 0
        view = await get_calendar_policy_view(session, access.member_id, access.org_id)
        assert not view.can_create_team_calendars

    async def test_a_personal_calendar_stays_open_to_everyone(self, session, access) -> None:
        await _restrict(session, access)

        calendar = await _create(session, access, access.member_id, name="mine")

        assert calendar.calendar_type == CalendarType.PERSONAL

    async def test_a_member_cannot_open_a_calendar_to_the_organization(
        self, session, access
    ) -> None:
        await _restrict(session, access)
        calendar = await _create(session, access, access.member_id, name="closed")
        calendar_id = calendar.id

        with pytest.raises(PermissionDeniedError):
            await _members(session).set_access_mode(
                actor_user_id=access.member_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar_id,
                new_access_mode=AccessMode.OPEN_TO_ORG,
                new_baseline_role=ContentRole.VIEWER,
            )
        await session.rollback()

        assert (
            await session.scalar(select(Calendar.access_mode).where(Calendar.id == calendar_id))
            == AccessMode.OWNER_ONLY
        )

    async def test_clearing_the_mode_cannot_inherit_an_open_default(self, session, access) -> None:
        await _restrict(session, access)
        session.add(
            OrganizationPermissionDefaults(
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                default_access_mode=AccessMode.OPEN_TO_ORG,
                default_baseline_role=ContentRole.VIEWER,
                updated_by_user_id=access.owner_id,
            )
        )
        await session.commit()
        calendar = await _create(session, access, access.member_id, name="inherits")
        calendar_id = calendar.id

        with pytest.raises(PermissionDeniedError):
            await _members(session).set_access_mode(
                actor_user_id=access.member_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar_id,
                new_access_mode=None,
            )
        await session.rollback()

        assert (
            await session.scalar(select(Calendar.access_mode).where(Calendar.id == calendar_id))
            == AccessMode.OWNER_ONLY
        )

    async def test_a_member_cannot_create_one_already_open(self, session, access) -> None:
        await _restrict(session, access)

        with pytest.raises(PermissionDeniedError):
            await _create(
                session,
                access,
                access.member_id,
                name="born-open",
                access_mode=AccessMode.OPEN_TO_ORG,
                baseline_role=ContentRole.VIEWER,
            )
        await session.rollback()

        assert await _calendars_named(session, access, "born-open") == 0

    async def test_an_org_admin_may_do_both(self, session, access) -> None:
        await _restrict(session, access)

        calendar = await _create(
            session,
            access,
            access.admin_id,
            calendar_type=CalendarType.TEAM,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

        assert calendar.access_mode == AccessMode.OPEN_TO_ORG

    async def test_a_calendar_domain_admin_may_do_both(self, session, access) -> None:
        await _restrict(session, access)
        await _grant_calendar_admin(session, access, access.peer_id)
        calendar = await _create(session, access, access.peer_id, calendar_type=CalendarType.TEAM)
        calendar_id = calendar.id

        await _members(session).set_access_mode(
            actor_user_id=access.peer_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            new_access_mode=AccessMode.OPEN_TO_ORG,
            new_baseline_role=ContentRole.VIEWER,
        )

        assert (
            await session.scalar(select(Calendar.access_mode).where(Calendar.id == calendar_id))
            == AccessMode.OPEN_TO_ORG
        )

    async def test_a_deactivated_domain_admin_is_refused(self, session, access) -> None:
        await _restrict(session, access)
        await _grant_calendar_admin(session, access, access.peer_id)
        membership = await session.scalar(
            select(OrganizationMember).where(
                OrganizationMember.user_id == access.peer_id,
                OrganizationMember.organization_id == access.org_id,
            )
        )
        membership.is_active = False
        await session.commit()

        with pytest.raises(PermissionDeniedError):
            await _create(
                session, access, access.peer_id, name="ghosted", calendar_type=CalendarType.TEAM
            )
        await session.rollback()

        assert await _calendars_named(session, access, "ghosted") == 0


class TestPolicyUpdates:
    async def test_only_org_admins_change_the_policy(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError):
            await update_calendar_policy(
                session,
                access.member_id,
                access.org_id,
                team_calendar_creators=ADMINS,
                org_wide_calendar_sharers=ADMINS,
            )
        await session.rollback()

        policy = await resolve_calendar_policy(session, access.org_id)
        assert (policy.team_calendar_creators, policy.org_wide_calendar_sharers) == (
            EVERYONE,
            EVERYONE,
        )

    async def test_an_update_is_audited_with_the_previous_values(self, session, access) -> None:
        await _restrict(session, access, team=ADMINS, org_wide=EVERYONE)

        audit = await session.scalar(
            select(AuditEvent).where(
                AuditEvent.organization_id == access.org_id,
                AuditEvent.action == Action.CALENDAR_POLICY_UPDATED,
            )
        )
        assert audit is not None
        assert audit.details["team_calendar_creators"] == ADMINS.value
        assert audit.details["previous_team_calendar_creators"] == EVERYONE.value

    async def test_a_failed_audit_leaves_the_policy_unchanged(self, session, access) -> None:
        with (
            patch(
                "uniffy.domains.scheduling.calendar.policy.write_audit_event",
                AsyncMock(side_effect=RuntimeError("audit down")),
            ),
            pytest.raises(RuntimeError),
        ):
            await _restrict(session, access)
        await session.rollback()

        policy = await resolve_calendar_policy(session, access.org_id)
        assert policy.team_calendar_creators == EVERYONE

    async def test_non_members_cannot_read_the_policy(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError):
            await get_calendar_policy_view(session, access.outsider_id, access.org_id)


class TestTransfer:
    async def test_a_default_calendar_never_changes_hands(self, session, access) -> None:
        calendar = await ensure_default_calendar(session, access.org_id, access.member_id)
        calendar_id = calendar.id

        with pytest.raises(ValidationError):
            await _members(session).transfer_ownership(
                actor_user_id=access.member_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar_id,
                new_owner_user_id=access.peer_id,
            )
        await session.rollback()

        assert (
            await session.scalar(select(Calendar.owner_id).where(Calendar.id == calendar_id))
            == access.member_id
        )

    async def test_any_other_calendar_can_be_transferred(self, session, access) -> None:
        calendar = await _create(session, access, access.member_id, calendar_type=CalendarType.TEAM)
        calendar_id = calendar.id

        await _members(session).transfer_ownership(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            new_owner_user_id=access.peer_id,
        )

        assert (
            await session.scalar(select(Calendar.owner_id).where(Calendar.id == calendar_id))
            == access.peer_id
        )
