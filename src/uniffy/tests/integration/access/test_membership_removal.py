"""Membership removal, reactivation and org shutdown, proven on the rows the gates return."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentType
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import _make_system_admin

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _membership(session, user_id: UUID, org_id: UUID) -> OrganizationMember:
    return (
        await session.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _remove(session, access, target_user_id: UUID) -> bool:
    return await OrganizationOperations(session).remove_member(
        access.owner_id,
        access.org_id,
        target_user_id,
        search_indexer=AsyncMock(),
        call_lifecycle=CallsLifecycle(open_session),
    )


async def _join_other_org(session, access, user_id: UUID) -> None:
    session.add(
        OrganizationMember(
            user_id=user_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        )
    )
    await session.commit()


async def _visible_note_ids(session, user_id: UUID, org_id: UUID) -> set[UUID]:
    condition = await ContentAccessQuery(session).build_accessible_filter(
        user_id=user_id,
        organization_id=org_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        owner_id_column=Note.owner_id,
        access_mode_column=Note.access_mode,
        baseline_role_column=Note.baseline_role,
    )
    rows = await session.execute(select(Note.id).where(Note.organization_id == org_id, condition))
    return {row[0] for row in rows.all()}


async def _removal_audit_count(session, access, user_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.organization_id == access.org_id,
                AuditEvent.action == Action.ORGANIZATION_MEMBER_REMOVED,
                AuditEvent.resource_id == user_id,
            )
        )
    ).scalar_one()


async def _user_org_ids(session, user_id: UUID) -> list[UUID]:
    rows = await OrganizationOperations(session).get_user_organizations(user_id)
    return [org.id for org, _ in rows]


class TestRemoval:
    async def test_removal_keeps_the_row_and_cuts_off_every_gate(self, session, access) -> None:
        assert access.private_note_id in await _visible_note_ids(
            session, access.member_id, access.org_id
        )

        assert await _remove(session, access, access.member_id) is True

        row = await _membership(session, access.member_id, access.org_id)
        assert row.is_active is False
        assert row.removed_at is not None
        assert row.removed_by_user_id == access.owner_id
        with pytest.raises(PermissionDeniedError):
            await OrganizationOperations(session).require_org_member(access.member_id, access.org_id)
        assert access.org_id not in await _user_org_ids(session, access.member_id)
        assert await _visible_note_ids(session, access.member_id, access.org_id) == set()

    async def test_re_adding_reactivates_the_same_row(self, session, access) -> None:
        removed_row_id = (await _membership(session, access.member_id, access.org_id)).id
        await _remove(session, access, access.member_id)

        await OrganizationOperations(session).stage_member(
            access.member_id,
            access.org_id,
            actor_user_id=access.admin_id,
            source=OrganizationMemberSource.INVITE,
            invited_by_user_id=access.admin_id,
        )
        await session.commit()

        row = await _membership(session, access.member_id, access.org_id)
        assert row.id == removed_row_id
        assert row.is_active is True
        assert row.removed_at is None
        assert row.removed_by_user_id is None
        assert row.source is OrganizationMemberSource.INVITE
        assert row.invited_by_user_id == access.admin_id
        assert access.private_note_id in await _visible_note_ids(
            session, access.member_id, access.org_id
        )

    async def test_a_second_removal_is_a_no_op(self, session, access) -> None:
        assert await _remove(session, access, access.member_id) is True
        first_removed_at = (await _membership(session, access.member_id, access.org_id)).removed_at

        assert await _remove(session, access, access.member_id) is False

        assert await _removal_audit_count(session, access, access.member_id) == 1
        row = await _membership(session, access.member_id, access.org_id)
        assert row.removed_at == first_removed_at

    async def test_a_duplicate_membership_row_is_refused(self, session, access) -> None:
        session.add(
            OrganizationMember(
                user_id=access.member_id,
                organization_id=access.org_id,
                role=OrganizationRole.MEMBER,
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()


class TestOrganizationListing:
    async def test_deleted_orgs_drop_out_and_suspended_orgs_stay_flagged(
        self, session, access
    ) -> None:
        await _join_other_org(session, access, access.member_id)
        await session.execute(
            update(Organization)
            .where(Organization.id == access.org_id)
            .values(is_suspended=True, suspended_at=datetime.now(UTC))
        )
        await session.execute(
            update(Organization)
            .where(Organization.id == access.other_org_id)
            .values(deleted_at=datetime.now(UTC))
        )
        await session.commit()

        rows = await OrganizationOperations(session).get_user_organizations(access.member_id)

        assert [(org.id, org.is_suspended) for org, _ in rows] == [(access.org_id, True)]


class TestSuspension:
    async def test_suspension_cuts_off_only_that_org(self, session, access) -> None:
        await _make_system_admin(session, access.outsider_id)
        await _join_other_org(session, access, access.member_id)
        token_version = (
            await session.execute(select(User.token_version).where(User.id == access.member_id))
        ).scalar_one()

        await PlatformDirectoryOperations(
            session, CallsLifecycle(open_session)
        ).suspend_organization(
            user_id=access.outsider_id, organization_id=access.org_id, reason="abuse"
        )

        assert (
            await session.execute(select(User.token_version).where(User.id == access.member_id))
        ).scalar_one() == token_version
        ops = OrganizationOperations(session)
        with pytest.raises(PermissionDeniedError):
            await ops.require_org_member(access.member_id, access.org_id)
        assert await _visible_note_ids(session, access.member_id, access.org_id) == set()
        other = await ops.require_org_member(access.member_id, access.other_org_id)
        assert other.organization_id == access.other_org_id
