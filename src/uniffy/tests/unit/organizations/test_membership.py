"""Membership staging records how a row was granted; removal keeps the row as history."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.types import generate_id
from uniffy.domains.chat.cleanup import ChatMembershipCleanup
from uniffy.domains.organizations.operations import OrganizationOperations

_MODULE = "uniffy.domains.organizations.operations"


def _audit_rows(session: MagicMock, action: Action) -> list[AuditEvent]:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and isinstance(call.args[0], AuditEvent) and call.args[0].action == action
    ]


def _staging_session(org: Organization) -> MagicMock:
    locked_org = MagicMock()
    locked_org.scalar_one_or_none.return_value = org
    session = MagicMock()
    session.execute = AsyncMock(return_value=locked_org)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    return session


async def _stage(
    session: MagicMock,
    existing: OrganizationMember | None,
    *args: object,
    **kwargs: object,
):
    with (
        patch.object(OrganizationOperations, "get_membership", AsyncMock(return_value=existing)),
        patch.object(OrganizationOperations, "_require_member_capacity", AsyncMock()),
        patch(f"{_MODULE}.stage_personal_attachments_folder", AsyncMock()),
        patch(f"{_MODULE}.stage_default_channel_memberships", AsyncMock(return_value=[])),
    ):
        return await OrganizationOperations(session).stage_member(*args, **kwargs)


def _org() -> Organization:
    return Organization(id=generate_id(), name="Acme", slug="acme", plan="free", settings={})


class TestStageMember:
    async def test_new_row_records_source_and_inviter(self) -> None:
        org = _org()
        session = _staging_session(org)
        user_id = generate_id()
        inviter_id = generate_id()

        staged = await _stage(
            session,
            None,
            user_id,
            org.id,
            OrganizationRole.MEMBER,
            inviter_id,
            source=OrganizationMemberSource.INVITE,
            invited_by_user_id=inviter_id,
        )

        membership = staged.membership
        session.add.assert_any_call(membership)
        assert membership.source is OrganizationMemberSource.INVITE
        assert membership.invited_by_user_id == inviter_id
        (added,) = _audit_rows(session, Action.ORGANIZATION_MEMBER_ADDED)
        assert added.details == {
            "role": OrganizationRole.MEMBER.value,
            "source": OrganizationMemberSource.INVITE.value,
            "reactivated": False,
        }
        session.commit.assert_not_awaited()

    async def test_default_source_is_added(self) -> None:
        org = _org()
        session = _staging_session(org)

        staged = await _stage(session, None, generate_id(), org.id)

        assert staged.membership.source is OrganizationMemberSource.ADDED
        assert staged.membership.invited_by_user_id is None

    async def test_reactivation_restores_the_same_row(self) -> None:
        org = _org()
        session = _staging_session(org)
        user_id = generate_id()
        inviter_id = generate_id()
        existing = OrganizationMember(
            user_id=user_id,
            organization_id=org.id,
            role=OrganizationRole.MEMBER,
            is_active=False,
            source=OrganizationMemberSource.SCIM,
            removed_at=datetime.now(UTC),
            removed_by_user_id=generate_id(),
        )

        staged = await _stage(
            session,
            existing,
            user_id,
            org.id,
            OrganizationRole.ADMIN,
            inviter_id,
            source=OrganizationMemberSource.ADDED,
            invited_by_user_id=inviter_id,
        )

        assert staged.membership is existing
        assert existing.is_active is True
        assert existing.role is OrganizationRole.ADMIN
        assert existing.source is OrganizationMemberSource.ADDED
        assert existing.invited_by_user_id == inviter_id
        assert existing.removed_at is None
        assert existing.removed_by_user_id is None
        assert not any(
            isinstance(call.args[0], OrganizationMember) for call in session.add.call_args_list
        )
        (added,) = _audit_rows(session, Action.ORGANIZATION_MEMBER_ADDED)
        assert added.details["reactivated"] is True
        assert added.details["source"] == OrganizationMemberSource.ADDED.value


class TestStageOrganizationOwner:
    @pytest.mark.parametrize(
        ("owner_source", "expected"),
        [
            (None, OrganizationMemberSource.CREATED),
            (OrganizationMemberSource.BOOTSTRAP, OrganizationMemberSource.BOOTSTRAP),
        ],
    )
    async def test_owner_membership_source(
        self,
        owner_source: OrganizationMemberSource | None,
        expected: OrganizationMemberSource,
    ) -> None:
        owner_id = generate_id()
        owner_lookup = MagicMock()
        owner_lookup.scalar_one_or_none.return_value = SimpleNamespace(id=owner_id)
        session = MagicMock()
        session.add = MagicMock()
        session.add_all = MagicMock()
        session.flush = AsyncMock()
        session.execute = AsyncMock(return_value=owner_lookup)
        cipher = MagicMock(provision=AsyncMock())
        channels = MagicMock(stage_channel=AsyncMock(return_value=MagicMock()))
        kwargs = {} if owner_source is None else {"owner_source": owner_source}

        with (
            patch(f"{_MODULE}.OrgCipher", return_value=cipher),
            patch(f"{_MODULE}.stage_personal_attachments_folder", AsyncMock()),
            patch(f"{_MODULE}.create_default_presets", AsyncMock()),
            patch(f"{_MODULE}.create_default_tag_filter_presets", AsyncMock()),
            patch(f"{_MODULE}.ChatChannelOperations", return_value=channels),
            patch(f"{_MODULE}.stage_default_agent", AsyncMock(return_value=MagicMock())),
            patch(f"{_MODULE}.write_audit_event", AsyncMock()),
        ):
            await OrganizationOperations(session).stage_organization(
                "Acme", "acme", owner_id, **kwargs
            )

        added = [row for call in session.add_all.call_args_list for row in call.args[0]]
        (owner,) = [row for row in added if isinstance(row, OrganizationMember)]
        assert owner.role is OrganizationRole.OWNER
        assert owner.source is expected


def _removal_session(membership: OrganizationMember, order: list[str]) -> MagicMock:
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=membership))
    )
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock(side_effect=lambda: order.append("commit"))
    return session


class TestRemoveMember:
    async def test_removal_deactivates_then_fans_out_once(self) -> None:
        admin_id = generate_id()
        org_id = generate_id()
        target_id = generate_id()
        membership = OrganizationMember(
            user_id=target_id,
            organization_id=org_id,
            role=OrganizationRole.MEMBER,
        )
        order: list[str] = []
        session = _removal_session(membership, order)
        publish = AsyncMock(side_effect=lambda *_: order.append("publish"))
        call_lifecycle = MagicMock()
        call_lifecycle.evict_user = AsyncMock(side_effect=lambda *_, **__: order.append("evict"))
        cleanup = AsyncMock(return_value=ChatMembershipCleanup((), (), ()))
        ops = OrganizationOperations(session)

        with (
            patch.object(OrganizationOperations, "require_org_admin", AsyncMock()),
            patch(f"{_MODULE}.cleanup_chat_membership_for_organization", cleanup),
            patch(f"{_MODULE}.publish_membership_revoke_safe", publish),
            patch(f"{_MODULE}.UserDirectoryProjection.remove_from_organization", AsyncMock()),
        ):
            first = await ops.remove_member(
                admin_id,
                org_id,
                target_id,
                search_indexer=MagicMock(),
                call_lifecycle=call_lifecycle,
            )
            second = await ops.remove_member(
                admin_id,
                org_id,
                target_id,
                search_indexer=MagicMock(),
                call_lifecycle=call_lifecycle,
            )

        assert first is True
        assert second is False
        session.delete.assert_not_awaited()
        assert membership.is_active is False
        assert membership.removed_at is not None
        assert membership.removed_at.tzinfo is not None
        assert membership.removed_by_user_id == admin_id
        assert membership.updated_at == membership.removed_at
        assert order == ["commit", "publish", "evict"]
        publish.assert_awaited_once_with(target_id, org_id)
        cleanup.assert_awaited_once()
        assert len(_audit_rows(session, Action.ORGANIZATION_MEMBER_REMOVED)) == 1

    async def test_owner_is_refused_without_effects(self) -> None:
        membership = OrganizationMember(
            user_id=generate_id(),
            organization_id=generate_id(),
            role=OrganizationRole.OWNER,
        )
        order: list[str] = []
        session = _removal_session(membership, order)
        publish = AsyncMock()

        with (
            patch.object(OrganizationOperations, "require_org_admin", AsyncMock()),
            patch(f"{_MODULE}.publish_membership_revoke_safe", publish),
            pytest.raises(PermissionDeniedError),
        ):
            await OrganizationOperations(session).remove_member(
                generate_id(),
                membership.organization_id,
                membership.user_id,
                search_indexer=MagicMock(),
                call_lifecycle=MagicMock(),
            )

        assert membership.is_active is True
        assert order == []
        publish.assert_not_awaited()
