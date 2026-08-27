"""Invite + accept flows with DB session, queue, and OrgOps mocked.

Tests focus on the dispatch contract: which audit actions are written,
which email template gets enqueued, and that the existing-user branch
goes through ``OrganizationOperations.add_member``.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationEmailConflictError,
    InvitationExpiredError,
    InvitationRevokedError,
)
from uniffy.domains.invitations.operations import (
    InvitationOperations,
    InviteOutcome,
    _hash_token,
)


@dataclass
class _FakeUser:
    id: Any
    email: str
    username: str = "alice"
    full_name: str | None = None
    is_active: bool = True
    token_version: int = 0
    avatar_key: str | None = None
    hashed_password: str | None = None


@dataclass
class _FakeOrg:
    id: Any
    name: str = "Acme"
    slug: str = "acme"


@dataclass
class _Invitation:
    """Stand-in for the SQLModel row -- attributes set by the ops layer.

    Mocking the actual SQLModel is awkward because ``self._session.add`` does
    not run validators; instead we drop the object the caller hands us into
    this fake row container.
    """

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

    session.execute = execute
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _patch_queue():
    queue = AsyncMock()
    queue.enqueue_job = AsyncMock()
    return patch(
        "uniffy.domains.invitations.operations.enqueue_job",
        new=queue.enqueue_job,
    ), queue


def _patch_audit():
    return patch(
        "uniffy.domains.invitations.operations.write_audit_event",
        new=AsyncMock(),
    )


def _patch_org_ops(*, get_by_id_returns: _FakeOrg, add_member_returns: Any | None = None):
    org_ops = MagicMock()
    org_ops.require_org_admin = AsyncMock()
    org_ops.get_by_id = AsyncMock(return_value=get_by_id_returns)
    org_ops.add_member = AsyncMock(return_value=add_member_returns)
    cls = MagicMock(return_value=org_ops)
    return patch(
        "uniffy.domains.invitations.operations._get_org_ops_cls",
        return_value=cls,
    ), org_ops


class TestInviteExistingUser:
    async def test_auto_adds_member_and_emails(self) -> None:
        inviter_id = generate_id()
        existing_id = generate_id()
        org = _FakeOrg(id=generate_id())
        inviter = _FakeUser(id=inviter_id, email="boss@acme.io", username="boss")
        existing = _FakeUser(id=existing_id, email="member@acme.io")
        membership = SimpleNamespace(id=generate_id(), role=OrganizationRole.MEMBER)

        # Order: lookup inviter, lookup existing user-by-email.
        session = _make_session([_result(scalar=inviter), _result(scalar=existing)])
        queue_patch, queue = _patch_queue()
        org_ops_patch, org_ops = _patch_org_ops(
            get_by_id_returns=org,
            add_member_returns=membership,
        )

        with _patch_audit(), queue_patch, org_ops_patch:
            ops = InvitationOperations(session)
            result = await ops.invite(
                org_id=org.id,
                email="MEMBER@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert result.outcome is InviteOutcome.ADDED
        assert result.member is membership
        org_ops.add_member.assert_awaited_once()
        # Template enqueued is the courtesy notice, not the accept link.
        queue.enqueue_job.assert_awaited()
        call = queue.enqueue_job.await_args
        assert call.args[2] == "auth/added_to_org"


class TestInviteNewEmail:
    async def test_writes_row_and_enqueues_accept_link(self) -> None:
        inviter_id = generate_id()
        org = _FakeOrg(id=generate_id())
        inviter = _FakeUser(id=inviter_id, email="boss@acme.io", username="boss")

        # Order: lookup inviter, lookup existing-by-email (None), select pending (none).
        pending = []
        session = _make_session([
            _result(scalar=inviter),
            _result(scalar=None),
            _result(scalars=pending),
        ])
        queue_patch, queue = _patch_queue()
        org_ops_patch, _org = _patch_org_ops(get_by_id_returns=org)

        with _patch_audit() as audit, queue_patch, org_ops_patch:
            ops = InvitationOperations(session)
            result = await ops.invite(
                org_id=org.id,
                email="new@acme.io",
                role=OrganizationRole.MEMBER,
                inviter_id=inviter_id,
            )

        assert result.outcome is InviteOutcome.INVITED
        # Session received an Invitation row via .add().
        session.add.assert_called_once()
        # Audit event emitted with the invite action.
        actions = [c.kwargs["action"] for c in audit.call_args_list]
        assert Action.ORGANIZATION_MEMBER_INVITED in actions
        # Email enqueued with the invitation template.
        call = queue.enqueue_job.await_args
        assert call.args[2] == "auth/invitation"


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
        org_id = generate_id()
        inv = _Invitation(
            organization_id=org_id,
            email="x@y.com",
            role=OrganizationRole.MEMBER,
            invited_by_user_id=generate_id(),
            token_hash=_hash_token("raw"),
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationExpiredError):
            await ops.get_for_token("raw")

    async def test_revoked_raises(self) -> None:
        inv = _Invitation(
            organization_id=generate_id(),
            email="x@y.com",
            role=OrganizationRole.MEMBER,
            invited_by_user_id=generate_id(),
            token_hash=_hash_token("raw"),
            expires_at=datetime.now(UTC) + timedelta(days=1),
            revoked_at=datetime.now(UTC),
        )
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationRevokedError):
            await ops.get_for_token("raw")

    async def test_already_used_raises(self) -> None:
        inv = _Invitation(
            organization_id=generate_id(),
            email="x@y.com",
            role=OrganizationRole.MEMBER,
            invited_by_user_id=generate_id(),
            token_hash=_hash_token("raw"),
            expires_at=datetime.now(UTC) + timedelta(days=1),
            accepted_at=datetime.now(UTC),
        )
        session = _make_session([_result(scalar=inv)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationAlreadyUsedError):
            await ops.get_for_token("raw")


class TestAcceptRejectsConflict:
    async def test_existing_user_with_same_email_blocks_accept(self) -> None:
        existing = _FakeUser(id=generate_id(), email="x@y.com")
        inv = _Invitation(
            organization_id=generate_id(),
            email="x@y.com",
            role=OrganizationRole.MEMBER,
            invited_by_user_id=generate_id(),
            token_hash=_hash_token("raw"),
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        # Load invitation -> ok; lookup email -> conflict.
        session = _make_session([_result(scalar=inv), _result(scalar=existing)])
        ops = InvitationOperations(session)
        with pytest.raises(InvitationEmailConflictError):
            await ops.accept(
                raw_token="raw",
                username="new_user",
                password="Passw0rd!ok",
                full_name=None,
                user_agent="pytest",
            )
