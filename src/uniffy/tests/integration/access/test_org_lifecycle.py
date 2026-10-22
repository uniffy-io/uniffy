"""Self-service creation, leaving, ownership transfer and owner deletion on real rows."""

import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from uniffy.core.audit.actions import Action
from uniffy.core.config.org_creation import (
    OrgCreationPolicy,
    resolve_org_creation,
)
from uniffy.core.config.source import SettingSource
from uniffy.core.errors import (
    MembershipRequiredError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.files.saved_filter import SavedFileFilter
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.people.identity import IdentitySource
from uniffy.core.models.tags.saved_filter import SavedTagFilter
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.organizations.creation import create_organization_for_user
from uniffy.domains.organizations.lifecycle import (
    OWNER_DELETION_REASON,
    delete_organization_by_owner,
    leave_organization,
    lock_organization,
    transfer_ownership,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import _make_system_admin
from uniffy.tests.integration.access.conftest import teardown_organizations
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")

_ORG_CREATION_ENV = "ALLOW_ORG_CREATION"
_LOCK_WAIT_SECONDS = 0.3
_DELETE_TIMEOUT_SECONDS = 10


async def _user_org_ids(session, user_id: UUID) -> list[UUID]:
    rows = await OrganizationOperations(session).get_user_organizations(user_id)
    return [org.id for org, _ in rows]


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


async def _audit_count(session, org_id: UUID, action: str) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.organization_id == org_id, AuditEvent.action == action)
        )
    ).scalar_one()


@pytest_asyncio.fixture(loop_scope="session")
async def created_orgs(session, access) -> AsyncIterator[list[UUID]]:
    """Organizations a test creates through the full bootstrap, removed with every row it adds."""
    org_ids: list[UUID] = []
    try:
        yield org_ids
    finally:
        if org_ids:
            await session.rollback()
            for model in (Agent, SavedFileFilter, SavedTagFilter, IdentitySource, OrgEncryptionKey):
                await session.execute(delete(model).where(model.organization_id.in_(org_ids)))
            await session.commit()
            await teardown_organizations(session, org_ids, [])


@pytest_asyncio.fixture(loop_scope="session")
async def env_tier_only(session) -> None:
    """A deployment row would shadow the environment tier these cases set."""
    if (await resolve_org_creation(session)).source is SettingSource.DEPLOYMENT:
        pytest.skip("deployment_settings carries an org_creation row on this database")


_LADDER = {
    OrgCreationPolicy.OPERATORS_ONLY: {"owner": False, "member": False, "unaffiliated": False},
    OrgCreationPolicy.OPERATORS_AND_OWNERS: {"owner": True, "member": False, "unaffiliated": False},
    OrgCreationPolicy.MEMBERS: {"owner": True, "member": True, "unaffiliated": False},
    OrgCreationPolicy.ANYONE: {"owner": True, "member": True, "unaffiliated": True},
}


class TestCreation:
    @pytest.mark.parametrize("policy", list(OrgCreationPolicy), ids=lambda p: p.value)
    async def test_the_policy_ladder_decides_who_may_create(
        self, session, access, created_orgs, env_tier_only, monkeypatch, policy
    ) -> None:
        monkeypatch.setenv(_ORG_CREATION_ENV, policy.value)
        # ghost holds only a deactivated membership, which counts as none.
        users = {
            "owner": access.owner_id,
            "member": access.member_id,
            "unaffiliated": access.ghost_id,
        }

        for label, user_id in users.items():
            name = f"{label} {policy.value} {user_id.hex[:8]}"
            if not _LADDER[policy][label]:
                with pytest.raises(PermissionDeniedError):
                    await create_organization_for_user(
                        session,
                        user_id=user_id,
                        name=name,
                        slug=None,
                        search_indexer=recording_indexer(),
                    )
                continue

            org, membership = await create_organization_for_user(
                session, user_id=user_id, name=name, slug=None, search_indexer=recording_indexer()
            )
            created_orgs.append(org.id)
            assert membership.role is OrganizationRole.OWNER
            assert membership.source is OrganizationMemberSource.CREATED
            assert org.created_by_user_id == user_id
            assert org.id in await _user_org_ids(session, user_id)
            await OrganizationOperations(session).require_org_owner(user_id, org.id)

    async def test_an_operator_may_always_create(
        self, session, access, created_orgs, env_tier_only, monkeypatch
    ) -> None:
        monkeypatch.setenv(_ORG_CREATION_ENV, OrgCreationPolicy.OPERATORS_ONLY.value)
        await _make_system_admin(session, access.ghost_id)

        org, _ = await create_organization_for_user(
            session,
            user_id=access.ghost_id,
            name=f"Operator {access.ghost_id.hex[:8]}",
            slug=None,
            search_indexer=recording_indexer(),
        )
        created_orgs.append(org.id)

        assert org.id in await _user_org_ids(session, access.ghost_id)


class TestLeave:
    async def test_a_member_who_leaves_fails_every_gate(self, session, access) -> None:
        await leave_organization(
            session,
            user_id=access.member_id,
            org_id=access.org_id,
            search_indexer=recording_indexer(),
            call_lifecycle=CallsLifecycle(open_session),
        )

        row = await _membership(session, access.member_id, access.org_id)
        assert row.is_active is False
        assert row.removed_by_user_id == access.member_id
        ops = OrganizationOperations(session)
        with pytest.raises(MembershipRequiredError):
            await ops.require_org_member(access.member_id, access.org_id)
        assert access.org_id not in await _user_org_ids(session, access.member_id)
        assert await _audit_count(session, access.org_id, Action.ORGANIZATION_MEMBER_LEFT) == 1
        assert await _audit_count(session, access.org_id, Action.ORGANIZATION_MEMBER_REMOVED) == 0

    async def test_the_owner_cannot_leave(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError, match="Transfer ownership"):
            await leave_organization(
                session,
                user_id=access.owner_id,
                org_id=access.org_id,
                search_indexer=recording_indexer(),
                call_lifecycle=CallsLifecycle(open_session),
            )
        await session.rollback()

        assert (await _membership(session, access.owner_id, access.org_id)).is_active is True
        await OrganizationOperations(session).require_org_owner(access.owner_id, access.org_id)


class TestTransfer:
    async def test_the_owner_gate_moves_to_the_new_owner(self, session, access) -> None:
        new_owner, previous_owner = await transfer_ownership(
            session,
            owner_user_id=access.owner_id,
            org_id=access.org_id,
            new_owner_user_id=access.member_id,
        )

        assert (new_owner.role, previous_owner.role) == (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        )
        ops = OrganizationOperations(session)
        await ops.require_org_owner(access.member_id, access.org_id)
        with pytest.raises(PermissionDeniedError) as refused:
            await ops.require_org_owner(access.owner_id, access.org_id)
        assert not isinstance(refused.value, MembershipRequiredError)
        await ops.require_org_admin(access.owner_id, access.org_id)
        assert (
            await _audit_count(session, access.org_id, Action.ORGANIZATION_OWNERSHIP_TRANSFERRED)
            == 1
        )

    async def test_a_removed_member_cannot_receive_ownership(self, session, access) -> None:
        with pytest.raises(NotFoundError):
            await transfer_ownership(
                session,
                owner_user_id=access.owner_id,
                org_id=access.org_id,
                new_owner_user_id=access.ghost_id,
            )
        await session.rollback()

        await OrganizationOperations(session).require_org_owner(access.owner_id, access.org_id)


class TestOwnerDelete:
    async def test_every_member_loses_the_organization(self, session, access) -> None:
        members = [access.owner_id, access.admin_id, access.member_id, access.peer_id]

        purge_at = await delete_organization_by_owner(
            session,
            user_id=access.owner_id,
            org_id=access.org_id,
            confirm_slug=f" {(await session.get(Organization, access.org_id)).slug} ",
            call_lifecycle=CallsLifecycle(open_session),
        )

        org = await session.get(Organization, access.org_id, populate_existing=True)
        assert org.deleted_at is not None
        assert org.deleted_by_user_id == access.owner_id
        assert org.deletion_reason == OWNER_DELETION_REASON
        assert purge_at > org.deleted_at
        ops = OrganizationOperations(session)
        for user_id in members:
            assert access.org_id not in await _user_org_ids(session, user_id)
            with pytest.raises(MembershipRequiredError):
                await ops.require_org_member(user_id, access.org_id)
        assert await _audit_count(session, access.org_id, Action.ORGANIZATION_DELETED) == 1
        assert access.other_org_id in await _user_org_ids(session, access.outsider_id)

    async def test_a_wrong_slug_or_a_non_owner_changes_nothing(self, session, access) -> None:
        with pytest.raises(ValidationError):
            await delete_organization_by_owner(
                session,
                user_id=access.owner_id,
                org_id=access.org_id,
                confirm_slug="not-the-slug",
                call_lifecycle=CallsLifecycle(open_session),
            )
        await session.rollback()
        slug = (await session.get(Organization, access.org_id)).slug
        with pytest.raises(PermissionDeniedError):
            await delete_organization_by_owner(
                session,
                user_id=access.admin_id,
                org_id=access.org_id,
                confirm_slug=slug,
                call_lifecycle=CallsLifecycle(open_session),
            )
        await session.rollback()

        assert access.org_id in await _user_org_ids(session, access.member_id)
        deleted_at = (
            await session.execute(
                select(Organization.deleted_at).where(Organization.id == access.org_id)
            )
        ).scalar_one()
        assert deleted_at is None

    async def test_a_deactivated_owner_cannot_delete(self, session, access) -> None:
        await session.execute(update(User).where(User.id == access.owner_id).values(is_active=False))
        await session.commit()

        with pytest.raises(MembershipRequiredError):
            await delete_organization_by_owner(
                session,
                user_id=access.owner_id,
                org_id=access.org_id,
                confirm_slug=(await session.get(Organization, access.org_id)).slug,
                call_lifecycle=CallsLifecycle(open_session),
            )

    async def test_an_operator_delete_queued_behind_the_owner_stages_nothing(
        self, session, access
    ) -> None:
        await _make_system_admin(session, access.outsider_id)
        slug = (await session.get(Organization, access.org_id)).slug
        # The owner's transaction holds the row while the operator's delete starts.
        await lock_organization(session, access.org_id)

        async with open_session() as operator_session:
            operator_delete = asyncio.create_task(
                PlatformDirectoryOperations(
                    operator_session, CallsLifecycle(open_session)
                ).delete_organization(
                    user_id=access.outsider_id,
                    organization_id=access.org_id,
                    confirm_slug=slug,
                    reason="Abuse report",
                )
            )
            await asyncio.sleep(_LOCK_WAIT_SECONDS)
            assert not operator_delete.done()

            await delete_organization_by_owner(
                session,
                user_id=access.owner_id,
                org_id=access.org_id,
                confirm_slug=slug,
                call_lifecycle=CallsLifecycle(open_session),
            )
            await asyncio.wait_for(operator_delete, timeout=_DELETE_TIMEOUT_SECONDS)

        org = await session.get(Organization, access.org_id, populate_existing=True)
        assert org.deleted_by_user_id == access.owner_id
        assert org.deletion_reason == OWNER_DELETION_REASON
        assert await _audit_count(session, access.org_id, Action.ORGANIZATION_DELETED) == 1
        assert (
            await _audit_count(session, access.org_id, Action.ORGANIZATION_DELETED_BY_PLATFORM)
            == 0
        )
