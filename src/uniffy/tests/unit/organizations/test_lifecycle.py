"""Leaving, ownership transfer, owner and platform deletion, and renaming an organization."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import UUID

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    MembershipRequiredError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.json_codec import loads
from uniffy.core.mail import render_template
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.calls import CallEndReason
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.calls.lifecycle import CallEvictionReason
from uniffy.domains.chat.cleanup import ChatMembershipCleanup
from uniffy.domains.mail.jobs.contracts import SEND_EMAIL
from uniffy.domains.organizations import lifecycle
from uniffy.domains.organizations.lifecycle import (
    OWNER_DELETION_REASON,
    PURGE_GRACE_DAYS,
    delete_organization_by_owner,
    enqueue_org_deleted_emails,
    leave_organization,
    transfer_ownership,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations

_OPERATIONS = "uniffy.domains.organizations.operations"
_LIFECYCLE = "uniffy.domains.organizations.lifecycle"
_SLUG = "acme"


def _member(
    org_id: UUID,
    role: OrganizationRole = OrganizationRole.MEMBER,
    *,
    is_active: bool = True,
    user_id: UUID | None = None,
) -> OrganizationMember:
    return OrganizationMember(
        user_id=user_id or generate_id(),
        organization_id=org_id,
        role=role,
        is_active=is_active,
    )


def _user(user_id: UUID, *, is_active: bool = True) -> User:
    return User(
        id=user_id,
        email=f"{user_id.hex[:8]}@example.com",
        username=user_id.hex[:12],
        hashed_password="x",
        is_active=is_active,
    )


def _org(*, deleted_at: datetime | None = None) -> Organization:
    return Organization(
        id=generate_id(),
        name="Acme",
        slug=_SLUG,
        plan="free",
        deleted_at=deleted_at,
        purge_warning_sent_at=datetime.now(UTC),
    )


def _session(order: list[str], result: MagicMock) -> MagicMock:
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.rollback = AsyncMock()
    session.commit = AsyncMock(side_effect=lambda: order.append("commit"))
    return session


def _audit_rows(session: MagicMock, action: str) -> list[AuditEvent]:
    return [
        c.args[0]
        for c in session.add.call_args_list
        if c.args and isinstance(c.args[0], AuditEvent) and c.args[0].action == action
    ]


class TestLeave:
    async def _leave(
        self, membership: OrganizationMember, order: list[str], call_lifecycle: MagicMock
    ) -> tuple[MagicMock, AsyncMock, AsyncMock]:
        session = _session(order, MagicMock(scalar_one_or_none=MagicMock(return_value=membership)))
        publish = AsyncMock(side_effect=lambda *_: order.append("publish"))
        cleanup = AsyncMock(return_value=ChatMembershipCleanup((), (), ()))
        with (
            patch.object(OrganizationOperations, "require_org_member", AsyncMock()),
            patch(f"{_OPERATIONS}.cleanup_chat_membership_for_organization", cleanup),
            patch(f"{_OPERATIONS}.publish_membership_revoke_safe", publish),
            patch(f"{_OPERATIONS}.UserDirectoryProjection.remove_from_organization", AsyncMock()),
        ):
            await leave_organization(
                session,
                user_id=membership.user_id,
                org_id=membership.organization_id,
                search_indexer=MagicMock(),
                call_lifecycle=call_lifecycle,
            )
        return session, publish, cleanup

    async def test_owner_is_told_to_transfer_first(self) -> None:
        membership = _member(generate_id(), OrganizationRole.OWNER)
        order: list[str] = []

        with pytest.raises(PermissionDeniedError, match="Transfer ownership before leaving"):
            await self._leave(membership, order, MagicMock())

        assert membership.is_active is True
        assert order == []

    async def test_member_leaves_with_the_left_action_and_fans_out_after_commit(self) -> None:
        membership = _member(generate_id(), OrganizationRole.ADMIN)
        order: list[str] = []
        call_lifecycle = MagicMock()
        call_lifecycle.evict_user = AsyncMock(side_effect=lambda *_, **__: order.append("evict"))

        session, publish, cleanup = await self._leave(membership, order, call_lifecycle)

        assert membership.is_active is False
        assert membership.removed_by_user_id == membership.user_id
        assert membership.removed_at is not None
        (left,) = _audit_rows(session, Action.ORGANIZATION_MEMBER_LEFT)
        assert left.actor_user_id == membership.user_id
        assert left.details["previous_role"] == OrganizationRole.ADMIN.value
        assert _audit_rows(session, Action.ORGANIZATION_MEMBER_REMOVED) == []
        assert order == ["commit", "publish", "evict"]
        publish.assert_awaited_once_with(membership.user_id, membership.organization_id)
        call_lifecycle.evict_user.assert_awaited_once_with(
            session,
            membership.user_id,
            reason=CallEvictionReason.MEMBERSHIP_REVOKED,
            organization_id=membership.organization_id,
            actor_user_id=membership.user_id,
        )
        cleanup.assert_awaited_once()

    async def test_a_membership_removed_meanwhile_is_left_alone(self) -> None:
        membership = _member(generate_id(), is_active=False)
        order: list[str] = []

        session, publish, _ = await self._leave(membership, order, MagicMock())

        assert order == []
        publish.assert_not_awaited()
        assert _audit_rows(session, Action.ORGANIZATION_MEMBER_LEFT) == []

    async def test_the_membership_gate_runs_first(self) -> None:
        session = _session([], MagicMock())
        refusal = MembershipRequiredError("Requires organization membership")

        with (
            patch.object(
                OrganizationOperations, "require_org_member", AsyncMock(side_effect=refusal)
            ),
            pytest.raises(MembershipRequiredError),
        ):
            await leave_organization(
                session,
                user_id=generate_id(),
                org_id=generate_id(),
                search_indexer=MagicMock(),
                call_lifecycle=MagicMock(),
            )

        session.execute.assert_not_awaited()


class TestTransfer:
    async def _transfer(
        self,
        rows: list[tuple[OrganizationMember, User]],
        *,
        owner_id: UUID,
        org_id: UUID,
        new_owner_id: UUID,
    ) -> tuple[tuple[OrganizationMember, OrganizationMember], MagicMock, AsyncMock]:
        session = _session([], MagicMock(all=MagicMock(return_value=rows)))
        audit = AsyncMock()
        with (
            patch.object(OrganizationOperations, "require_org_owner", AsyncMock()),
            patch(f"{_LIFECYCLE}.write_audit_event", audit),
        ):
            result = await transfer_ownership(
                session,
                owner_user_id=owner_id,
                org_id=org_id,
                new_owner_user_id=new_owner_id,
            )
        return result, session, audit

    async def test_roles_swap_and_one_audit_row_is_written(self) -> None:
        org_id = generate_id()
        owner = _member(org_id, OrganizationRole.OWNER)
        target = _member(org_id)

        (new_owner, previous_owner), session, audit = await self._transfer(
            [(owner, _user(owner.user_id)), (target, _user(target.user_id))],
            owner_id=owner.user_id,
            org_id=org_id,
            new_owner_id=target.user_id,
        )

        assert (new_owner, previous_owner) == (target, owner)
        assert target.role is OrganizationRole.OWNER
        assert owner.role is OrganizationRole.ADMIN
        assert target.updated_at == owner.updated_at
        session.commit.assert_awaited_once()
        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["action"] == Action.ORGANIZATION_OWNERSHIP_TRANSFERRED
        assert kwargs["resource_type"] is AuditResourceType.ORGANIZATION
        assert kwargs["resource_id"] == org_id
        assert kwargs["actor_user_id"] == owner.user_id
        assert kwargs["details"] == {
            "previous_owner_user_id": str(owner.user_id),
            "new_owner_user_id": str(target.user_id),
        }

    async def test_self_transfer_is_refused(self) -> None:
        owner_id = generate_id()
        session = _session([], MagicMock())

        with (
            patch.object(OrganizationOperations, "require_org_owner", AsyncMock()),
            pytest.raises(ValidationError, match="Already the owner"),
        ):
            await transfer_ownership(
                session, owner_user_id=owner_id, org_id=generate_id(), new_owner_user_id=owner_id
            )

        session.execute.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_non_owner_is_refused_by_the_gate(self) -> None:
        session = _session([], MagicMock())

        with (
            patch.object(
                OrganizationOperations,
                "require_org_owner",
                AsyncMock(side_effect=PermissionDeniedError("Requires organization owner")),
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await transfer_ownership(
                session,
                owner_user_id=generate_id(),
                org_id=generate_id(),
                new_owner_user_id=generate_id(),
            )

        session.execute.assert_not_awaited()

    @pytest.mark.parametrize(
        ("target_state", "error"),
        [
            ("missing", NotFoundError),
            ("removed", NotFoundError),
            ("deactivated_account", PermissionDeniedError),
        ],
    )
    async def test_target_must_be_an_active_member_with_an_active_account(
        self, target_state: str, error: type[Exception]
    ) -> None:
        org_id = generate_id()
        owner = _member(org_id, OrganizationRole.OWNER)
        target = _member(org_id, is_active=target_state != "removed")
        rows = [(owner, _user(owner.user_id))]
        if target_state != "missing":
            rows.append((
                target,
                _user(target.user_id, is_active=target_state != "deactivated_account"),
            ))

        with pytest.raises(error):
            await self._transfer(
                rows, owner_id=owner.user_id, org_id=org_id, new_owner_id=target.user_id
            )

        assert owner.role is OrganizationRole.OWNER
        assert target.role is OrganizationRole.MEMBER

    async def test_an_owner_demoted_meanwhile_is_refused(self) -> None:
        org_id = generate_id()
        owner = _member(org_id, OrganizationRole.ADMIN)
        target = _member(org_id)

        with pytest.raises(PermissionDeniedError, match="owner privileges"):
            await self._transfer(
                [(owner, _user(owner.user_id)), (target, _user(target.user_id))],
                owner_id=owner.user_id,
                org_id=org_id,
                new_owner_id=target.user_id,
            )

        assert target.role is OrganizationRole.MEMBER


def _deletion_session(org: Organization, member_ids: list[UUID], order: list[str]) -> MagicMock:
    result = MagicMock(
        scalar_one_or_none=MagicMock(return_value=org),
        all=MagicMock(return_value=[(member_id,) for member_id in member_ids]),
    )
    return _session(order, result)


class TestOwnerDelete:
    async def _delete(
        self,
        session: MagicMock,
        org: Organization,
        order: list[str],
        *,
        confirm_slug: str = _SLUG,
        gate: AsyncMock | None = None,
    ) -> tuple[datetime, AsyncMock, AsyncMock, AsyncMock, MagicMock]:
        audit = AsyncMock()
        publish = AsyncMock(side_effect=lambda *_: order.append("publish"))
        mails = AsyncMock(side_effect=lambda *_, **__: order.append("mail"))
        call_lifecycle = MagicMock(end_for_organization=AsyncMock())
        with (
            patch.object(OrganizationOperations, "require_org_owner", gate or AsyncMock()),
            patch(f"{_LIFECYCLE}.write_audit_event", audit),
            patch(f"{_LIFECYCLE}.publish_membership_revoke_safe", publish),
            patch(f"{_LIFECYCLE}.enqueue_org_deleted_emails", mails),
        ):
            purge_at = await delete_organization_by_owner(
                session,
                user_id=generate_id(),
                org_id=org.id,
                confirm_slug=confirm_slug,
                call_lifecycle=call_lifecycle,
            )
        return purge_at, audit, publish, mails, call_lifecycle

    async def test_soft_deletes_audits_and_fans_out_after_commit(self) -> None:
        org = _org()
        member_ids = [generate_id(), generate_id()]
        order: list[str] = []
        session = _deletion_session(org, member_ids, order)

        purge_at, audit, publish, mails, call_lifecycle = await self._delete(
            session, org, order, confirm_slug=f"  {_SLUG} "
        )

        assert org.deleted_at is not None
        assert org.deletion_reason == OWNER_DELETION_REASON
        assert org.purge_warning_sent_at is None
        assert purge_at == org.deleted_at + timedelta(days=PURGE_GRACE_DAYS)
        kwargs = audit.await_args.kwargs
        assert org.deleted_by_user_id == kwargs["actor_user_id"]
        assert kwargs["action"] == Action.ORGANIZATION_DELETED
        assert kwargs["details"] == {
            "reason": OWNER_DELETION_REASON,
            "purge_at": purge_at.isoformat(),
            "members_notified": [str(member_id) for member_id in member_ids],
        }
        assert order == ["commit", "publish", "publish", "mail"]
        assert publish.await_args_list == [call(member_id, org.id) for member_id in member_ids]
        call_lifecycle.end_for_organization.assert_awaited_once_with(
            session, org.id, CallEndReason.ORG_DELETED
        )
        mails.assert_awaited_once_with(session, org, OWNER_DELETION_REASON, deleted_by_owner=True)

    async def test_a_wrong_slug_changes_nothing(self) -> None:
        org = _org()
        order: list[str] = []
        session = _deletion_session(org, [], order)

        with pytest.raises(ValidationError, match="Confirmation slug does not match"):
            await self._delete(session, org, order, confirm_slug="acme-typo")

        assert org.deleted_at is None
        assert order == []

    async def test_the_owner_gate_runs_first(self) -> None:
        org = _org()
        session = _deletion_session(org, [], [])
        gate = AsyncMock(side_effect=PermissionDeniedError("Requires organization owner"))

        with pytest.raises(PermissionDeniedError):
            await self._delete(session, org, [], gate=gate)

        session.execute.assert_not_awaited()
        assert org.deleted_at is None

    async def test_a_concurrent_delete_returns_the_recorded_purge_time(self) -> None:
        deleted_at = datetime.now(UTC) - timedelta(days=2)
        org = _org(deleted_at=deleted_at)
        order: list[str] = []
        session = _deletion_session(org, [generate_id()], order)

        purge_at, audit, publish, _, _ = await self._delete(session, org, order)

        assert purge_at == deleted_at + timedelta(days=PURGE_GRACE_DAYS)
        assert order == []
        audit.assert_not_awaited()
        publish.assert_not_awaited()


class TestPlatformDelete:
    async def _delete(
        self, session: MagicMock, org: Organization, order: list[str], operator_id: UUID
    ) -> tuple[str, AsyncMock, AsyncMock, AsyncMock, MagicMock]:
        call_lifecycle = MagicMock(end_for_organization=AsyncMock())
        ops = PlatformDirectoryOperations(session, call_lifecycle)
        ops._user_ops.require_system_admin = AsyncMock()
        ops.get_organization = AsyncMock(return_value="detail")
        audit = AsyncMock()
        publish = AsyncMock(side_effect=lambda *_: order.append("publish"))
        mails = AsyncMock()

        with (
            patch("uniffy.domains.platform.directory.operations.check_rate_limit", AsyncMock()),
            patch(f"{_LIFECYCLE}.write_audit_event", audit),
            patch(f"{_LIFECYCLE}.publish_membership_revoke_safe", publish),
            patch(f"{_LIFECYCLE}.enqueue_org_deleted_emails", mails),
        ):
            result = await ops.delete_organization(
                user_id=operator_id,
                organization_id=org.id,
                confirm_slug=_SLUG,
                reason=" Abuse report ",
            )
        return result, audit, publish, mails, call_lifecycle

    async def test_platform_delete_keeps_its_audit_action_and_fanout(self) -> None:
        org = _org()
        member_ids = [generate_id()]
        order: list[str] = []
        session = _deletion_session(org, member_ids, order)
        operator_id = generate_id()

        result, audit, _, mails, call_lifecycle = await self._delete(
            session, org, order, operator_id
        )

        assert result == "detail"
        assert org.deleted_by_user_id == operator_id
        assert org.deletion_reason == "Abuse report"
        kwargs = audit.await_args.kwargs
        assert kwargs["action"] == Action.ORGANIZATION_DELETED_BY_PLATFORM
        assert kwargs["details"] == {
            "reason": "Abuse report",
            "purge_at": (org.deleted_at + timedelta(days=PURGE_GRACE_DAYS)).isoformat(),
            "members_notified": [str(member_ids[0])],
        }
        assert order == ["commit", "publish"]
        call_lifecycle.end_for_organization.assert_awaited_once_with(
            session, org.id, CallEndReason.ORG_DELETED
        )
        mails.assert_awaited_once_with(session, org, "Abuse report", deleted_by_owner=False)

    async def test_loads_the_organization_under_a_row_lock(self) -> None:
        org = _org()
        session = _deletion_session(org, [], [])

        await self._delete(session, org, [], generate_id())

        statement = session.execute.await_args_list[0].args[0]
        assert "FOR UPDATE" in str(statement.compile(dialect=postgresql.dialect()))
        assert statement.get_execution_options()["populate_existing"] is True

    async def test_a_delete_that_won_the_lock_first_is_left_untouched(self) -> None:
        deleted_at = datetime.now(UTC) - timedelta(minutes=1)
        org = _org(deleted_at=deleted_at)
        org.deleted_by_user_id = generate_id()
        owner_id = org.deleted_by_user_id
        order: list[str] = []
        session = _deletion_session(org, [generate_id()], order)

        result, audit, publish, mails, _ = await self._delete(session, org, order, generate_id())

        assert result == "detail"
        assert (org.deleted_at, org.deleted_by_user_id) == (deleted_at, owner_id)
        assert order == []
        audit.assert_not_awaited()
        publish.assert_not_awaited()
        mails.assert_not_awaited()


class TestDeletionMails:
    @pytest.mark.parametrize(
        ("deleted_by_owner", "opening"),
        [
            (True, "The owner of Acme deleted the workspace"),
            (False, "A platform operator marked your workspace"),
        ],
    )
    async def test_each_active_owner_gets_one_idempotent_mail(
        self, deleted_by_owner: bool, opening: str
    ) -> None:
        org = _org(deleted_at=datetime(2026, 10, 1, 9, 30, tzinfo=UTC))
        owner_id = generate_id()
        session = MagicMock()
        session.execute = AsyncMock(
            return_value=MagicMock(all=MagicMock(return_value=[(owner_id, "owner@example.com")]))
        )
        enqueue = AsyncMock()

        with patch(f"{_LIFECYCLE}.enqueue_job", enqueue):
            await enqueue_org_deleted_emails(
                session, org, "Cleanup", deleted_by_owner=deleted_by_owner
            )

        (args, kwargs) = enqueue.await_args
        assert args[:3] == (SEND_EMAIL, "owner@example.com", "platform/org_deleted")
        context = loads(args[3])
        assert context == {
            "org_name": "Acme",
            "deleted_at": "October 01, 2026 at 09:30 UTC",
            "purge_at": "October 31, 2026 at 09:30 UTC",
            "grace_days": PURGE_GRACE_DAYS,
            "reason": "Cleanup",
            "deleted_by_owner": deleted_by_owner,
        }
        assert kwargs == {
            "organization_id": str(org.id),
            "idempotency_key": f"platform_org_deleted/{org.id}/{owner_id}",
            "user_id": str(owner_id),
        }
        # Strict undefined fails the render on any key the template reads but the context lacks.
        rendered = await render_template(args[2], context)
        for body in (rendered.text, rendered.html):
            assert opening in body
            assert "Access to the workspace ends now." in body
            assert "A platform operator can restore it before then." in body
            assert "Sign-in" not in body
            assert "support" not in body

    async def test_a_live_organization_sends_nothing(self) -> None:
        session = MagicMock(execute=AsyncMock())

        await enqueue_org_deleted_emails(session, _org(), "Cleanup", deleted_by_owner=False)

        session.execute.assert_not_awaited()

    def test_purge_time_follows_the_grace_window(self) -> None:
        deleted_at = datetime(2026, 1, 1, tzinfo=UTC)

        assert lifecycle.purge_at_from(None) is None
        assert lifecycle.purge_at_from(deleted_at) == datetime(2026, 1, 31, tzinfo=UTC)


class TestRename:
    async def _update(
        self, org: Organization, *, commit: AsyncMock | None = None, **changes: str
    ) -> tuple[MagicMock, AsyncMock, AsyncMock]:
        session = MagicMock()
        session.commit = commit or AsyncMock()
        session.rollback = AsyncMock()
        session.refresh = AsyncMock()
        audit = AsyncMock()
        available = AsyncMock()
        with (
            patch.object(OrganizationOperations, "get_by_id", AsyncMock(return_value=org)),
            patch(f"{_OPERATIONS}.write_audit_event", audit),
            patch(f"{_OPERATIONS}.ensure_slug_available", available),
        ):
            await OrganizationOperations(session).update(
                org.id, actor_user_id=generate_id(), **changes
            )
        return session, audit, available

    async def test_name_and_slug_are_normalised_and_the_old_slug_is_audited(self) -> None:
        org = _org()

        session, audit, available = await self._update(org, name="  Acme Labs ", slug=" Acme-Labs ")

        assert (org.name, org.slug) == ("Acme Labs", "acme-labs")
        available.assert_awaited_once_with(session, "acme-labs", exclude_org_id=org.id)
        assert audit.await_args.kwargs["details"] == {
            "changed_keys": ["name", "slug"],
            "previous_slug": _SLUG,
        }
        session.commit.assert_awaited_once()

    async def test_an_unchanged_slug_skips_the_availability_check(self) -> None:
        org = _org()

        _, audit, available = await self._update(org, slug=_SLUG.upper())

        available.assert_not_awaited()
        audit.assert_not_awaited()

    @pytest.mark.parametrize(
        ("changes", "field"),
        [({"name": "   "}, "name"), ({"slug": "a"}, "slug"), ({"slug": "no spaces"}, "slug")],
    )
    async def test_invalid_values_are_refused_before_any_write(
        self, changes: dict[str, str], field: str
    ) -> None:
        org = _org()

        with pytest.raises(ValidationError) as refused:
            await self._update(org, **changes)

        assert refused.value.field == field
        assert (org.name, org.slug) == ("Acme", _SLUG)

    async def test_a_slug_claimed_at_commit_reads_as_taken(self) -> None:
        org = _org()
        commit = AsyncMock(
            side_effect=IntegrityError(
                "UPDATE",
                {},
                Exception(
                    'duplicate key value violates unique constraint "ix_login_organizations_slug"'
                ),
            )
        )

        with pytest.raises(ValidationError, match="Slug is already in use"):
            await self._update(org, slug="taken", commit=commit)

    async def test_another_constraint_at_commit_is_not_reported_as_a_slug_conflict(self) -> None:
        org = _org()
        commit = AsyncMock(side_effect=IntegrityError("UPDATE", {}, Exception("check violation")))

        with pytest.raises(IntegrityError):
            await self._update(org, slug="taken", commit=commit)
