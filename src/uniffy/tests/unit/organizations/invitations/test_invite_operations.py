"""Invite + accept flows with DB session, queue, and OrgOps mocked.

Every address that is not already an active member gets a pending invitation and
the accept-link mail; membership is staged only when the invitation is accepted.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ConflictError, PermissionDeniedError, RateLimitExceededError
from uniffy.core.models.login.organization_member import (
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.types import generate_id
from uniffy.domains.organizations.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationRevokedError,
)
from uniffy.domains.organizations.invitations.operations import InvitationOperations
from uniffy.domains.organizations.invitations.reader import hash_token

_MODULE = "uniffy.domains.organizations.invitations.operations"


@dataclass
class _FakeUser:
    id: Any
    email: str
    username: str = "alice"
    full_name: str | None = None
    is_active: bool = True
    email_verified: bool = False
    token_version: int = 0
    avatar_key: str | None = None
    hashed_password: str | None = None


@dataclass
class _FakeOrg:
    id: Any
    name: str = "Acme"
    slug: str = "acme"
    deleted_at: datetime | None = None
    is_suspended: bool = False


@dataclass
class _Invitation:
    """Stand-in for the SQLModel row, since a mocked ``session.add`` runs no validators."""

    organization_id: Any
    email: str
    role: OrganizationRole
    invited_by_user_id: Any
    token_hash: str
    expires_at: datetime
    id: Any = None
    accepted_at: datetime | None = None
    accepted_by_user_id: Any | None = None
    revoked_at: datetime | None = None
    revoked_by_user_id: Any | None = None
    updated_at: datetime | None = None
    created_at: datetime = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.id is None:
            self.id = generate_id()
        if self.created_at is None:
            self.created_at = datetime.now(UTC)


def _pending_invitation(**fields: Any) -> _Invitation:
    values: dict[str, Any] = {
        "organization_id": generate_id(),
        "email": "x@y.com",
        "role": OrganizationRole.MEMBER,
        "invited_by_user_id": generate_id(),
        "token_hash": hash_token("raw"),
        "expires_at": datetime.now(UTC) + timedelta(days=1),
    }
    values.update(fields)
    return _Invitation(**values)


def _result(scalar=None, scalars=None):
    r = AsyncMock()
    if scalars is not None:
        wrapper = AsyncMock()
        wrapper.__iter__ = lambda self: iter(scalars)
        wrapper.all = lambda: scalars
        r.scalars = lambda: scalars  # iterable
    r.scalar_one_or_none = lambda: scalar
    return r


def _make_session(execute_results: list[Any]):
    session = AsyncMock()
    iterator = iter(execute_results)

    async def execute(_stmt, *args, **kwargs):
        try:
            return next(iterator)
        except StopIteration:
            return _result()

    session.execute = AsyncMock(side_effect=execute)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _patch_queue():
    queue = AsyncMock()
    queue.enqueue_job = AsyncMock()
    return patch(f"{_MODULE}.enqueue_job", new=queue.enqueue_job), queue


def _patch_audit():
    return patch(f"{_MODULE}.write_audit_event", new=AsyncMock())


def _patch_org_ops(
    *,
    get_by_id_returns: _FakeOrg,
    stage_member_returns: Any | None = None,
    membership: Any | None = None,
):
    org_ops = MagicMock()
    org_ops.require_org_admin = AsyncMock()
    org_ops.get_by_id = AsyncMock(return_value=get_by_id_returns)
    org_ops.get_membership = AsyncMock(return_value=membership)
    org_ops.stage_member = AsyncMock(return_value=stage_member_returns)
    org_ops.finish_member_add_after_commit = AsyncMock()
    return patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops), org_ops


@pytest.fixture(autouse=True)
def send_limit() -> Iterator[AsyncMock]:
    with patch(f"{_MODULE}.check_rate_limit", new=AsyncMock()) as limit:
        yield limit


def _spent(resource: str) -> RateLimitExceededError:
    return RateLimitExceededError(resource, 50, 3600, retry_after=60)


def _invited_details(audit: AsyncMock) -> dict[str, Any]:
    (invited,) = [
        c.kwargs
        for c in audit.call_args_list
        if c.kwargs["action"] == Action.ORGANIZATION_MEMBER_INVITED
    ]
    return invited["details"]


class TestInviteExistingUser:
    async def test_active_account_gets_a_pending_invitation_and_the_accept_link(self) -> None:
        inviter_id = generate_id()
        account_id = generate_id()
        org = _FakeOrg(id=generate_id())
        inviter = _FakeUser(id=inviter_id, email="boss@acme.io", username="boss")

        # Order: lookup inviter, account holding the email, select pending (none).
        session = _make_session([
            _result(scalar=inviter),
            _result(scalar=account_id),
            _result(scalars=[]),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, org_ops = _patch_org_ops(get_by_id_returns=org)

        with _patch_audit() as audit, queue_patch, org_ops_patch:
            invitation = await InvitationOperations(session).invite(
                org_id=org.id,
                email="MEMBER@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert invitation.email == "member@acme.io"
        session.add.assert_called_once_with(invitation)
        org_ops.get_membership.assert_awaited_once_with(account_id, org.id)
        org_ops.stage_member.assert_not_awaited()
        org_ops.finish_member_add_after_commit.assert_not_awaited()
        # Every org admin reads the audit log, so it never says whether the address has an account.
        assert "account_exists" not in _invited_details(audit)
        call = queue.enqueue_job.await_args
        assert call.args[2] == "auth/invitation"

    async def test_a_removed_member_gets_a_pending_invitation(self) -> None:
        inviter_id = generate_id()
        org = _FakeOrg(id=generate_id())
        session = _make_session([
            _result(scalar=_FakeUser(id=inviter_id, email="boss@acme.io")),
            _result(scalar=generate_id()),
            _result(scalars=[]),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(
            get_by_id_returns=org, membership=SimpleNamespace(is_active=False)
        )

        with _patch_audit(), queue_patch, org_ops_patch:
            invitation = await InvitationOperations(session).invite(
                org_id=org.id,
                email="removed@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert invitation.email == "removed@acme.io"
        session.commit.assert_awaited_once()
        queue.enqueue_job.assert_awaited_once()

    async def test_an_active_member_is_a_conflict_and_nothing_is_written(self) -> None:
        inviter_id = generate_id()
        org = _FakeOrg(id=generate_id())
        earlier = _pending_invitation(organization_id=org.id, email="member@acme.io")
        session = _make_session([
            _result(scalar=_FakeUser(id=inviter_id, email="boss@acme.io")),
            _result(scalar=generate_id()),
            _result(scalars=[earlier]),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(
            get_by_id_returns=org, membership=SimpleNamespace(is_active=True)
        )

        with (
            _patch_audit() as audit,
            queue_patch,
            org_ops_patch,
            pytest.raises(ConflictError, match="already a member of the organization"),
        ):
            await InvitationOperations(session).invite(
                org_id=org.id,
                email="member@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert session.execute.await_count == 2
        assert earlier.revoked_at is None
        session.add.assert_not_called()
        session.flush.assert_not_awaited()
        session.commit.assert_not_awaited()
        audit.assert_not_awaited()
        queue.enqueue_job.assert_not_awaited()

    async def test_a_non_admin_learns_nothing_about_membership(self) -> None:
        session = _make_session([])
        org_ops_patch, org_ops = _patch_org_ops(get_by_id_returns=_FakeOrg(id=generate_id()))
        org_ops.require_org_admin.side_effect = PermissionDeniedError("Requires org admin")

        with org_ops_patch, pytest.raises(PermissionDeniedError):
            await InvitationOperations(session).invite(
                org_id=generate_id(),
                email="member@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=generate_id(),
            )

        session.execute.assert_not_awaited()
        org_ops.get_membership.assert_not_awaited()

    async def test_an_admin_cannot_invite_an_owner(self, send_limit: AsyncMock) -> None:
        inviter_id = generate_id()
        org_id = generate_id()
        session = _make_session([])
        queue_patch, queue = _patch_queue()
        org_ops_patch, org_ops = _patch_org_ops(get_by_id_returns=_FakeOrg(id=org_id))

        with (
            _patch_audit() as audit,
            queue_patch,
            org_ops_patch,
            pytest.raises(PermissionDeniedError, match="Ownership moves only through a transfer"),
        ):
            await InvitationOperations(session).invite(
                org_id=org_id,
                email="owner@acme.io",
                role=OrganizationRole.OWNER,
                inviter_id=inviter_id,
            )

        org_ops.require_org_admin.assert_awaited_once_with(inviter_id, org_id)
        send_limit.assert_not_awaited()
        session.execute.assert_not_awaited()
        session.add.assert_not_called()
        audit.assert_not_awaited()
        queue.enqueue_job.assert_not_awaited()


class TestInviteNewEmail:
    async def test_writes_row_and_enqueues_accept_link(self) -> None:
        inviter_id = generate_id()
        org = _FakeOrg(id=generate_id())
        inviter = _FakeUser(id=inviter_id, email="boss@acme.io", username="boss")

        # Order: lookup inviter, account holding the email (none), select pending (none).
        session = _make_session([
            _result(scalar=inviter),
            _result(scalar=None),
            _result(scalars=[]),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, org_ops = _patch_org_ops(get_by_id_returns=org)

        with _patch_audit() as audit, queue_patch, org_ops_patch:
            ops = InvitationOperations(session)
            invitation = await ops.invite(
                org_id=org.id,
                email="new@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        session.add.assert_called_once_with(invitation)
        org_ops.get_membership.assert_not_awaited()
        assert _invited_details(audit) == {
            "email": "new@acme.io",
            "role": OrganizationRole.MEMBER.value,
            "expires_at": invitation.expires_at.isoformat(),
        }
        # Email enqueued with the invitation template.
        call = queue.enqueue_job.await_args
        assert call.args[2] == "auth/invitation"


class TestSendRateLimit:
    async def test_invite_counts_against_the_inviter_and_the_organization(
        self, send_limit: AsyncMock
    ) -> None:
        inviter_id = generate_id()
        org = _FakeOrg(id=generate_id())
        session = _make_session([
            _result(scalar=_FakeUser(id=inviter_id, email="boss@acme.io")),
            _result(scalar=None),
            _result(scalars=[]),
        ])
        queue_patch, _queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(get_by_id_returns=org)

        with _patch_audit(), queue_patch, org_ops_patch:
            await InvitationOperations(session).invite(
                org_id=org.id,
                email="new@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert [call.kwargs["key"] for call in send_limit.await_args_list] == [
            f"rl:org:invite:user:{inviter_id}",
            f"rl:org:invite:org:{org.id}",
        ]

    async def test_a_spent_invite_bucket_stops_before_any_write(self, send_limit: AsyncMock) -> None:
        send_limit.side_effect = _spent("invitation emails (per organization)")
        session = _make_session([])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(get_by_id_returns=_FakeOrg(id=generate_id()))

        with (
            _patch_audit() as audit,
            queue_patch,
            org_ops_patch,
            pytest.raises(RateLimitExceededError),
        ):
            await InvitationOperations(session).invite(
                org_id=generate_id(),
                email="new@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=generate_id(),
            )

        session.execute.assert_not_awaited()
        session.add.assert_not_called()
        session.commit.assert_not_awaited()
        audit.assert_not_awaited()
        queue.enqueue_job.assert_not_awaited()

    async def test_resend_counts_against_the_same_buckets(self, send_limit: AsyncMock) -> None:
        actor_id = generate_id()
        invitation = _pending_invitation()
        org = _FakeOrg(id=invitation.organization_id)
        session = _make_session([
            _result(scalar=invitation),
            _result(scalar=_FakeUser(id=actor_id, email="boss@acme.io")),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(get_by_id_returns=org)

        with _patch_audit(), queue_patch, org_ops_patch:
            await InvitationOperations(session).resend(invitation.id, actor_id=actor_id)

        assert [call.kwargs["key"] for call in send_limit.await_args_list] == [
            f"rl:org:invite:user:{actor_id}",
            f"rl:org:invite:org:{org.id}",
        ]
        queue.enqueue_job.assert_awaited_once()

    async def test_a_spent_resend_bucket_keeps_the_current_link(self, send_limit: AsyncMock) -> None:
        send_limit.side_effect = _spent("invitation emails (per user)")
        invitation = _pending_invitation()
        token_hash = invitation.token_hash
        expires_at = invitation.expires_at
        session = _make_session([_result(scalar=invitation)])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org_ops = _patch_org_ops(
            get_by_id_returns=_FakeOrg(id=invitation.organization_id)
        )

        with (
            _patch_audit() as audit,
            queue_patch,
            org_ops_patch,
            pytest.raises(RateLimitExceededError),
        ):
            await InvitationOperations(session).resend(invitation.id, actor_id=generate_id())

        assert invitation.token_hash == token_hash
        assert invitation.expires_at == expires_at
        session.commit.assert_not_awaited()
        audit.assert_not_awaited()
        queue.enqueue_job.assert_not_awaited()


class TestRejectsObviouslyBadEmail:
    async def test_validation(self) -> None:
        session = _make_session([])
        org_ops_patch, _ = _patch_org_ops(get_by_id_returns=_FakeOrg(id=generate_id()))
        with org_ops_patch:
            ops = InvitationOperations(session)
            with pytest.raises(ValueError, match="Invalid email"):
                await ops.invite(
                    org_id=generate_id(),
                    email="not-an-email",
                    role=OrganizationRole.MEMBER,
                    inviter_id=generate_id(),
                )


class TestLoadByToken:
    async def test_expired_raises(self) -> None:
        inv = _pending_invitation(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationExpiredError):
            await ops.get_for_token("raw")

    async def test_revoked_raises(self) -> None:
        inv = _pending_invitation(revoked_at=datetime.now(UTC))
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationRevokedError):
            await ops.get_for_token("raw")

    async def test_already_used_raises(self) -> None:
        inv = _pending_invitation(accepted_at=datetime.now(UTC))
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationAlreadyUsedError):
            await ops.get_for_token("raw")


def _patch_preview_rate_limit():
    return patch(
        "uniffy.domains.organizations.invitations.reader.check_rate_limit",
        new=AsyncMock(),
    )


class TestPreview:
    @pytest.mark.parametrize("has_account", [True, False], ids=["account", "no-account"])
    async def test_account_exists_whenever_an_account_holds_the_address(
        self, has_account: bool
    ) -> None:
        inv = _pending_invitation()
        org = _FakeOrg(id=inv.organization_id)
        # Order: load invitation, organization, inviter, account holding the email.
        session = _make_session([
            _result(scalar=inv),
            _result(scalar=org),
            _result(scalar=None),
            _result(scalar=generate_id() if has_account else None),
        ])
        with _patch_preview_rate_limit():
            preview = await InvitationOperations(session).get_for_token("raw")

        assert preview.account_exists is has_account
        assert preview.organization is org
        assert preview.inviter_display_name == "A teammate"

    @pytest.mark.parametrize(
        ("fields", "error"),
        [
            ({"deleted_at": datetime.now(UTC)}, InvitationNotFoundError),
            ({"is_suspended": True}, PermissionDeniedError),
        ],
        ids=["deleted", "suspended"],
    )
    async def test_a_closed_organization_is_refused(
        self, fields: dict[str, Any], error: type[Exception]
    ) -> None:
        inv = _pending_invitation()
        session = _make_session([
            _result(scalar=inv),
            _result(scalar=_FakeOrg(id=inv.organization_id, **fields)),
        ])

        with _patch_preview_rate_limit(), pytest.raises(error):
            await InvitationOperations(session).get_for_token("raw")

        # Neither the inviter nor the account behind the address is looked up.
        assert session.execute.await_count == 2


class TestAcceptStagesInvitedMembership:
    async def test_membership_records_the_inviter_and_the_new_account_as_actor(self) -> None:
        inviter_id = generate_id()
        inv = _pending_invitation(email="new@acme.io", invited_by_user_id=inviter_id)
        org = _FakeOrg(id=inv.organization_id)
        new_user = _FakeUser(id=generate_id(), email="new@acme.io", username="new_user")
        outcome = object()
        staged_auth = SimpleNamespace(
            enrollment_required=False,
            session_id=generate_id(),
            outcome=outcome,
        )
        # Order: load invitation, organization, email free, username free.
        session = _make_session([
            _result(scalar=inv),
            _result(scalar=org),
            _result(scalar=None),
            _result(scalar=None),
        ])
        org_ops_patch, org_ops = _patch_org_ops(
            get_by_id_returns=org,
            stage_member_returns=SimpleNamespace(
                membership=SimpleNamespace(id=generate_id()),
                organization_slug="acme",
            ),
        )

        with (
            _patch_audit(),
            org_ops_patch,
            patch(f"{_MODULE}.client_ip_for_rate_limit", return_value=None),
            patch(f"{_MODULE}.stage_invited_user", new=AsyncMock(return_value=new_user)),
            patch(
                f"{_MODULE}.stage_invitation_authentication",
                new=AsyncMock(return_value=staged_auth),
            ),
        ):
            result = await InvitationOperations(session).accept(
                raw_token="raw",
                username="new_user",
                password="Passw0rd!ok",
                full_name=None,
                user_agent="pytest",
                search_indexer=MagicMock(),
            )

        assert result is outcome
        org_ops.stage_member.assert_awaited_once()
        staged = org_ops.stage_member.await_args.kwargs
        assert staged["user_id"] == new_user.id
        assert staged["source"] is OrganizationMemberSource.INVITE
        assert staged["invited_by_user_id"] == inviter_id
        assert staged["actor_user_id"] == new_user.id
        assert inv.accepted_by_user_id == new_user.id
        # The token reached the mailbox, so the new account may later use the signed-in list.
        assert new_user.email_verified is True
        session.commit.assert_awaited_once()
        org_ops.finish_member_add_after_commit.assert_awaited_once()
