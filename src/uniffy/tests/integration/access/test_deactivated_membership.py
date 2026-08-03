"""Deactivation is immediate and total, proven against real rows.

`OrganizationMember.is_active` is an access condition, not bookkeeping: a
deactivated member fails every org gate, their domain-admin row confers
nothing, their own content stops resolving, and list paths short-circuit to no
rows. Asserting that a query mentions `is_active` proves none of it - these
call the gates with a real deactivated row and check what happens.
"""

import pytest
from sqlalchemy import select

from uniffy.core.auth.domain_admin import get_user_domain_admins, is_domain_admin
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    DomainType,
    SubjectType,
    generate_id,
)
from uniffy.domains.agents.access import is_agents_builder, require_agents_builder
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.organizations.operations import OrganizationOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

ORG_GATES = ("require_org_member", "require_org_admin", "require_org_owner")


async def _grant_domain_admin(session, access, user_id, domain=DomainType.AGENTS) -> None:
    session.add(
        DomainAdmin(
            user_id=user_id,
            organization_id=access.org_id,
            domain=domain,
            granted_by=access.owner_id,
        )
    )
    await session.commit()


async def _deactivate(session, access, user_id) -> None:
    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == user_id,
            )
        )
    ).scalar_one()
    membership.is_active = False
    await session.commit()


async def _channel(session, access, channel_type=ChannelType.PRIVATE) -> ChatChannel:
    suffix = generate_id().hex[:8]
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name=f"room-{suffix}",
        slug=f"room-{suffix}",
        channel_type=channel_type,
    )
    session.add(channel)
    await session.flush()
    session.add(
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
        )
    )
    await session.commit()
    return channel


class TestOrgGates:
    @pytest.mark.parametrize("gate", ORG_GATES)
    async def test_deactivated_membership_is_denied(self, session, access, gate) -> None:
        ops = OrganizationOperations(session)
        with pytest.raises(PermissionDeniedError):
            await getattr(ops, gate)(access.ghost_id, access.org_id)

    async def test_an_active_owner_passes_every_gate(self, session, access) -> None:
        ops = OrganizationOperations(session)
        for gate in ORG_GATES:
            assert await getattr(ops, gate)(access.owner_id, access.org_id) is not None

    async def test_a_non_member_is_denied(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError):
            await OrganizationOperations(session).require_org_member(
                access.outsider_id, access.org_id
            )

    async def test_get_membership_still_returns_the_deactivated_row(self, session, access) -> None:
        """Management flows (re-add, role edit) need to see it; the gate is
        where the security decision lives."""
        membership = await OrganizationOperations(session).get_membership(
            access.ghost_id, access.org_id
        )
        assert membership is not None
        assert membership.is_active is False


class TestDomainAdminFollowsMembership:
    async def test_a_deactivated_members_domain_admin_row_confers_nothing(
        self, session, access
    ) -> None:
        await _grant_domain_admin(session, access, access.ghost_id)
        assert (
            await is_domain_admin(session, access.ghost_id, access.org_id, DomainType.AGENTS)
            is False
        )

    async def test_an_active_members_domain_admin_row_grants(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.member_id)
        assert (
            await is_domain_admin(session, access.member_id, access.org_id, DomainType.AGENTS)
            is True
        )

    async def test_domain_admin_claims_are_empty_when_deactivated(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.ghost_id, DomainType.CHAT)
        assert await get_user_domain_admins(session, access.ghost_id, access.org_id) == []

    async def test_domain_admin_claims_list_for_an_active_member(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.member_id, DomainType.CHAT)
        claims = await get_user_domain_admins(session, access.member_id, access.org_id)
        assert DomainType.CHAT in claims


class TestAgentsBuilderGate:
    async def test_a_deactivated_domain_admin_is_not_a_builder(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.ghost_id)
        assert await is_agents_builder(session, access.ghost_id, access.org_id) is False

    async def test_an_active_domain_admin_is_a_builder(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.member_id)
        assert await is_agents_builder(session, access.member_id, access.org_id) is True

    async def test_an_active_org_admin_is_a_builder(self, session, access) -> None:
        assert await is_agents_builder(session, access.admin_id, access.org_id) is True

    async def test_a_deactivated_org_admin_is_not_a_builder(self, session, access) -> None:
        await _deactivate(session, access, access.admin_id)
        assert await is_agents_builder(session, access.admin_id, access.org_id) is False

    async def test_the_builder_gate_raises_for_a_deactivated_member(self, session, access) -> None:
        await _grant_domain_admin(session, access, access.ghost_id)
        with pytest.raises(PermissionDeniedError):
            await require_agents_builder(session, access.ghost_id, access.org_id)


class TestEffectiveRoleMembershipGate:
    async def _role(self, session, access, user_id, note_id):
        note = (await session.execute(select(Note).where(Note.id == note_id))).scalar_one()
        return await PermissionChecker(session).effective_role(
            user_id=user_id,
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=note.id,
            owner_id=note.owner_id,
            access_mode=note.access_mode,
            baseline_role=note.baseline_role,
        )

    async def test_a_deactivated_member_loses_their_own_content(self, session, access) -> None:
        """Ownership does not survive deactivation."""
        note = Note(
            organization_id=access.org_id,
            owner_id=access.ghost_id,
            title="Ghost own",
            slug=f"ghost-own-{generate_id().hex[:8]}",
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(note)
        await session.commit()

        assert await self._role(session, access, access.ghost_id, note.id) is None

    async def test_a_deactivated_member_loses_an_explicit_grant(self, session, access) -> None:
        assert await self._role(session, access, access.ghost_id, access.shared_note_id) is None

    async def test_a_deactivated_member_loses_the_org_baseline(self, session, access) -> None:
        assert await self._role(session, access, access.ghost_id, access.org_note_id) is None

    async def test_a_non_member_resolves_to_nothing(self, session, access) -> None:
        assert await self._role(session, access, access.outsider_id, access.org_note_id) is None

    async def test_an_active_owner_resolves_to_owner(self, session, access) -> None:
        role = await self._role(session, access, access.member_id, access.private_note_id)
        assert role is ContentRole.OWNER

    async def test_an_active_grant_resolves(self, session, access) -> None:
        role = await self._role(session, access, access.peer_id, access.shared_note_id)
        assert role is ContentRole.VIEWER


class TestAccessFilterMembershipGate:
    async def _visible(self, session, access, user_id) -> set:
        query = ContentAccessQuery(session)
        condition = await query.build_accessible_filter(
            user_id=user_id,
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id_column=Note.id,
            owner_id_column=Note.owner_id,
            access_mode_column=Note.access_mode,
            baseline_role_column=Note.baseline_role,
        )
        rows = await session.execute(
            select(Note.id).where(Note.organization_id == access.org_id, condition)
        )
        return {row[0] for row in rows.all()}

    async def test_a_deactivated_actor_matches_no_rows(self, session, access) -> None:
        assert await self._visible(session, access, access.ghost_id) == set()

    async def test_an_actor_with_no_membership_matches_no_rows(self, session, access) -> None:
        assert await self._visible(session, access, access.outsider_id) == set()

    async def test_an_active_actor_gets_the_normal_filter(self, session, access) -> None:
        visible = await self._visible(session, access, access.peer_id)
        assert access.shared_note_id in visible
        assert access.private_note_id not in visible
        assert access.blocked_note_id not in visible


class TestAddMemberReactivation:
    async def test_readd_reactivates_and_applies_the_incoming_role(self, session, access) -> None:
        ops = OrganizationOperations(session)
        await ops.add_member(access.ghost_id, access.org_id, OrganizationRole.ADMIN)

        membership = await ops.get_membership(access.ghost_id, access.org_id)
        assert membership.is_active is True
        assert membership.role is OrganizationRole.ADMIN

    async def test_reactivation_restores_the_org_gate(self, session, access) -> None:
        ops = OrganizationOperations(session)
        await ops.add_member(access.ghost_id, access.org_id, OrganizationRole.MEMBER)
        assert await ops.require_org_member(access.ghost_id, access.org_id) is not None

    async def test_readd_leaves_exactly_one_membership_row(self, session, access) -> None:
        await OrganizationOperations(session).add_member(
            access.ghost_id, access.org_id, OrganizationRole.MEMBER
        )
        rows = await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == access.ghost_id,
            )
        )
        assert len(rows.scalars().all()) == 1


class TestChatModerationGate:
    async def test_a_deactivated_org_admin_is_not_a_moderator(self, session, access) -> None:
        membership = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == access.org_id,
                    OrganizationMember.user_id == access.admin_id,
                )
            )
        ).scalar_one()
        membership.is_active = False
        await session.commit()

        checker = ChatAccessChecker(session)
        assert await checker.is_org_admin(access.admin_id, access.org_id) is False

    async def test_an_active_org_admin_moderates_a_private_channel(self, session, access) -> None:
        channel = await _channel(session, access)
        checker = ChatAccessChecker(session)
        await checker.check_access(access.admin_id, access.org_id, channel)

    async def test_a_member_outside_a_private_channel_is_denied(self, session, access) -> None:
        channel = await _channel(session, access)
        with pytest.raises(PermissionDeniedError):
            await ChatAccessChecker(session).check_access(access.peer_id, access.org_id, channel)

    async def test_a_deactivated_admin_cannot_reach_a_private_channel(self, session, access) -> None:
        channel = await _channel(session, access)
        await _grant_domain_admin(session, access, access.admin_id, DomainType.CHAT)
        await _deactivate(session, access, access.admin_id)

        with pytest.raises(PermissionDeniedError):
            await ChatAccessChecker(session).check_access(access.admin_id, access.org_id, channel)

    async def test_a_deactivated_member_with_a_channel_row_still_reaches_it(
        self, session, access
    ) -> None:
        """Chat membership is its own model: deactivating the org membership
        drops the moderator bypass, not the channel row itself.
        """
        channel = await _channel(session, access)
        session.add(
            ChatChannelMember(
                channel_id=channel.id,
                subject_type=SubjectType.USER,
                subject_id=access.ghost_id,
                user_id=access.ghost_id,
            )
        )
        await session.commit()

        await ChatAccessChecker(session).check_access(access.ghost_id, access.org_id, channel)
