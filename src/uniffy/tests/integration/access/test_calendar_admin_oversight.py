"""Org admins oversee delegations and shared calendars without gaining any calendar content."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegationLevel
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    CalendarType,
    ContentRole,
    ContentType,
    DomainType,
    SubjectType,
    generate_id,
)
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.inventory import SharedCalendarInventory
from uniffy.domains.scheduling.calendar.delegation.operations import (
    CalendarDelegationOperations,
)
from uniffy.domains.scheduling.calendar.operations import CalendarEventReader

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=4)


def _indexer() -> SearchIndexer:
    return AsyncMock(spec=SearchIndexer)


async def _calendar(session, access, mode, *, baseline=None, name="Shared") -> Calendar:
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name=f"{name}-{generate_id().hex[:8]}",
        calendar_type=CalendarType.TEAM,
        access_mode=mode,
        baseline_role=baseline,
    )
    session.add(calendar)
    await session.commit()
    return calendar


async def _event(session, access, calendar_id) -> CalendarEvent:
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar_id,
        title=f"offsite-{generate_id().hex[:8]}",
        start_time=START,
        end_time=START + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(event)
    await session.commit()
    return event


async def _role(session, access, user_id, event) -> ContentRole | None:
    return await CalendarEventReader(session)._resolve_role(user_id, access.org_id, event)


class TestDelegationOversight:
    async def test_only_org_admins_see_and_revoke_delegations(self, session, access):
        view = await CalendarDelegationOperations(session).grant(
            access.member_id, access.org_id, access.peer_id, CalendarDelegationLevel.EVENTS
        )
        # A calendar domain admin manages calendar policy subjects, not this list.
        session.add(
            DomainAdmin(
                organization_id=access.org_id,
                user_id=access.peer_id,
                domain=DomainType.CALENDAR,
                granted_by=access.owner_id,
            )
        )
        await session.commit()
        operations = CalendarDelegationOperations(session)
        for stranger in (access.member_id, access.peer_id, access.outsider_id):
            with pytest.raises(PermissionDeniedError):
                await operations.list_for_org(stranger, access.org_id)
            with pytest.raises(PermissionDeniedError):
                await operations.admin_revoke(stranger, access.org_id, view.delegation.id)

        listed, _ = await operations.list_for_org(access.admin_id, access.org_id)
        assert [row.delegation.id for row in listed] == [view.delegation.id]
        assert listed[0].grantor_name and listed[0].delegate_name

        await operations.admin_revoke(access.admin_id, access.org_id, view.delegation.id)
        assert (await operations.list_for_org(access.admin_id, access.org_id))[0] == []
        audit = (
            await session.execute(
                select(AuditEvent).where(
                    AuditEvent.organization_id == access.org_id,
                    AuditEvent.resource_type == AuditResourceType.CALENDAR_DELEGATION,
                    AuditEvent.action == "calendar.delegation_revoked",
                )
            )
        ).scalar_one()
        assert audit.actor_user_id == access.admin_id
        assert audit.details["by"] == "admin"

    async def test_the_list_pages_by_cursor_and_filters_by_member(self, session, access):
        operations = CalendarDelegationOperations(session)
        first = await operations.grant(
            access.member_id, access.org_id, access.peer_id, CalendarDelegationLevel.EVENTS
        )
        second = await operations.grant(
            access.owner_id, access.org_id, access.peer_id, CalendarDelegationLevel.EVENTS
        )
        third = await operations.grant(
            access.owner_id, access.org_id, access.member_id, CalendarDelegationLevel.EVENTS
        )

        seen = []
        token = ""
        while True:
            page, token = await operations.list_for_org(
                access.admin_id, access.org_id, page_size=1, page_token=token
            )
            assert len(page) <= 1
            seen.extend(view.delegation.id for view in page)
            if not token:
                break
        assert seen == [third.delegation.id, second.delegation.id, first.delegation.id]

        filtered, _ = await operations.list_for_org(
            access.admin_id, access.org_id, user_id=access.member_id
        )
        assert {view.delegation.id for view in filtered} == {
            first.delegation.id,
            third.delegation.id,
        }

    async def test_an_inactive_grant_is_flagged(self, session, access):
        await CalendarDelegationOperations(session).grant(
            access.member_id, access.org_id, access.peer_id, CalendarDelegationLevel.EVENTS
        )
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.user_id == access.peer_id,
                OrganizationMember.organization_id == access.org_id,
            )
            .values(is_active=False)
        )
        await session.commit()
        listed, _ = await CalendarDelegationOperations(session).list_for_org(
            access.admin_id, access.org_id
        )
        assert listed and listed[0].inactive


class TestSharedCalendarInventory:
    async def test_lists_shared_calendars_only_and_only_for_org_admins(self, session, access):
        open_calendar = await _calendar(
            session, access, AccessMode.OPEN_TO_ORG, baseline=ContentRole.VIEWER, name="Open"
        )
        named = await _calendar(session, access, AccessMode.EXPLICIT_MEMBERS, name="Named")
        await ContentMembersOperations(session, _indexer()).add_member(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=named.id,
            subject_type=SubjectType.GROUP,
            subject_id=access.access_group_id,
            role=ContentRole.VIEWER,
        )
        private = await _calendar(session, access, AccessMode.OWNER_ONLY, name="Private")
        nobody_named = await _calendar(
            session, access, AccessMode.EXPLICIT_MEMBERS, name="Nobody named"
        )

        inventory = SharedCalendarInventory(session)
        for stranger in (access.member_id, access.peer_id, access.outsider_id):
            with pytest.raises(PermissionDeniedError):
                await inventory.list_shared(stranger, access.org_id)

        summaries, _ = await inventory.list_shared(access.admin_id, access.org_id)
        by_id = {summary.calendar_id: summary for summary in summaries}
        assert open_calendar.id in by_id and named.id in by_id
        assert private.id not in by_id
        assert nobody_named.id not in by_id
        assert by_id[open_calendar.id].access_mode is AccessMode.OPEN_TO_ORG
        assert by_id[open_calendar.id].baseline_role is ContentRole.VIEWER
        assert by_id[named.id].group_grant_count == 1
        assert by_id[named.id].user_grant_count == 0

    async def test_an_inherited_named_members_default_reaches_nobody(self, session, access):
        session.add(
            OrganizationPermissionDefaults(
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                default_access_mode=AccessMode.EXPLICIT_MEMBERS,
                default_baseline_role=None,
                updated_by_user_id=access.owner_id,
            )
        )
        await session.commit()
        inherits = await _calendar(session, access, None, name="Inherits")

        summaries, _ = await SharedCalendarInventory(session).list_shared(
            access.admin_id, access.org_id
        )
        assert inherits.id not in {summary.calendar_id for summary in summaries}

    async def test_pages_by_cursor(self, session, access):
        for index in range(3):
            await _calendar(
                session,
                access,
                AccessMode.OPEN_TO_ORG,
                baseline=ContentRole.VIEWER,
                name=f"P{index}",
            )
        inventory = SharedCalendarInventory(session)
        seen = []
        token = ""
        while True:
            page, token = await inventory.list_shared(
                access.admin_id, access.org_id, page_size=2, page_token=token
            )
            seen.extend(summary.calendar_id for summary in page)
            if not token:
                break
        assert len(seen) == len(set(seen)) >= 3

    async def test_restricting_keeps_named_members_and_drops_the_org(self, session, access):
        calendar = await _calendar(
            session, access, AccessMode.OPEN_TO_ORG, baseline=ContentRole.VIEWER
        )
        await ContentMembersOperations(session, _indexer()).add_member(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
        )
        event = await _event(session, access, calendar.id)
        assert await _role(session, access, access.owner_id, event) is ContentRole.VIEWER

        summary = await SharedCalendarInventory(session).restrict_to_members(
            access.admin_id, access.org_id, calendar.id, _indexer()
        )

        assert summary.access_mode is AccessMode.EXPLICIT_MEMBERS
        await session.refresh(calendar)
        assert calendar.access_mode is AccessMode.EXPLICIT_MEMBERS
        assert await _role(session, access, access.peer_id, event) is ContentRole.VIEWER
        assert await _role(session, access, access.owner_id, event) is None
        # The admin who restricted it gained nothing on the calendar or its events.
        assert await _role(session, access, access.admin_id, event) is None
        assert (
            await PermissionChecker(session).effective_role(
                user_id=access.admin_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar.id,
                owner_id=calendar.owner_id,
                access_mode=calendar.access_mode,
                baseline_role=calendar.baseline_role,
            )
            is None
        )
        audit = (
            await session.execute(
                select(AuditEvent).where(
                    AuditEvent.organization_id == access.org_id,
                    AuditEvent.action == "permissions.access_mode_changed",
                    AuditEvent.resource_id == calendar.id,
                )
            )
        ).scalar_one()
        assert audit.actor_user_id == access.admin_id

    async def test_restriction_only_tightens_and_only_for_org_admins(self, session, access):
        named = await _calendar(session, access, AccessMode.EXPLICIT_MEMBERS)
        with pytest.raises(ValidationError):
            await SharedCalendarInventory(session).restrict_to_members(
                access.admin_id, access.org_id, named.id, _indexer()
            )
        open_calendar = await _calendar(
            session, access, AccessMode.OPEN_TO_ORG, baseline=ContentRole.VIEWER
        )
        for stranger in (access.member_id, access.peer_id):
            with pytest.raises(PermissionDeniedError):
                await SharedCalendarInventory(session).restrict_to_members(
                    stranger, access.org_id, open_calendar.id, _indexer()
                )
        # Only calendars are restrictable; a note open to the org is out of reach.
        with pytest.raises(PermissionDeniedError):
            await ContentMembersOperations(session, _indexer()).stage_admin_restriction(
                access.admin_id, access.org_id, ContentType.NOTE, access.org_note_id
            )
