"""Accepting and declining invitations: signed in by token or id, and anonymously by token."""

from collections.abc import Iterator
from contextlib import ExitStack, asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_pb import AcceptInvitationRequest, GetInvitationRequest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    InvitationSignInRequiredError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.auth.handlers import AuthHandlers
from uniffy.domains.organizations.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationRevokedError,
)
from uniffy.domains.organizations.invitations.operations import AcceptVia, InvitationOperations
from uniffy.domains.organizations.invitations.reader import hash_token
from uniffy.transport.rpc import (
    SIGN_IN_REQUIRED_REASON,
    LoggingInterceptor,
    error_info_detail,
)

_MODULE = "uniffy.domains.organizations.invitations.operations"
_TOKEN = "raw-token"
_PASSWORD = "Fresh invitation password"


def _user(*, email: str = "member@acme.io", is_active: bool = True) -> User:
    return User(
        id=generate_id(),
        email=email,
        username="kept-name",
        full_name="Kept Name",
        hashed_password="old-hash",
        is_active=is_active,
        email_verified=False,
        token_version=3,
    )


def _org(**fields: Any) -> Organization:
    return Organization(id=generate_id(), name="Acme", slug="acme", **fields)


def _invitation(org: Organization, **fields: Any) -> Invitation:
    values: dict[str, Any] = {
        "organization_id": org.id,
        "email": "member@acme.io",
        "role": OrganizationRole.ADMIN,
        "invited_by_user_id": generate_id(),
        "token_hash": hash_token(_TOKEN),
        "expires_at": datetime.now(UTC) + timedelta(days=1),
    }
    values.update(fields)
    return Invitation(**values)


def _result(value: object = None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.all.return_value = []
    return result


def _session(*values: object) -> MagicMock:
    """Each ``execute`` answers with the next value, in the order the operation queries."""
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_result(value) for value in values])
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _org_ops(membership: OrganizationMember | None = None) -> MagicMock:
    org_ops = MagicMock()
    org_ops.stage_member = AsyncMock(
        return_value=SimpleNamespace(
            membership=membership or SimpleNamespace(id=generate_id()),
            organization_slug="acme",
        )
    )
    org_ops.finish_member_add_after_commit = AsyncMock()
    return org_ops


def _audit_calls(audit: AsyncMock, action: str) -> list[dict[str, Any]]:
    return [call.kwargs for call in audit.call_args_list if call.kwargs["action"] == action]


async def _accept_as_member(
    session: MagicMock,
    user: User,
    **lookup: Any,
) -> tuple[Organization, Any]:
    return await InvitationOperations(session).accept_as_member(
        user_id=user.id,
        search_indexer=MagicMock(),
        **lookup,
    )


class TestAcceptAsMember:
    async def test_token_path_joins_and_verifies_the_email(self) -> None:
        user = _user()
        org = _org()
        invitation = _invitation(org)
        membership = OrganizationMember(
            user_id=user.id, organization_id=org.id, role=OrganizationRole.ADMIN
        )
        org_ops = _org_ops(membership)
        session = _session(user, invitation, org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit,
        ):
            joined, member = await _accept_as_member(session, user, token=_TOKEN)

        assert joined is org
        assert member is membership
        staged = org_ops.stage_member.await_args.kwargs
        assert staged["user_id"] == user.id
        assert staged["org_id"] == org.id
        assert staged["role"] is OrganizationRole.ADMIN
        assert staged["source"] is OrganizationMemberSource.INVITE
        assert staged["invited_by_user_id"] == invitation.invited_by_user_id
        assert staged["actor_user_id"] == user.id
        assert invitation.accepted_at is not None
        assert invitation.accepted_by_user_id == user.id
        assert user.email_verified is True
        (accepted,) = _audit_calls(audit, Action.AUTH_INVITATION_ACCEPTED)
        assert accepted["organization_id"] == org.id
        assert accepted["details"]["signed_in"] is True
        assert accepted["details"]["via"] == AcceptVia.TOKEN
        session.commit.assert_awaited_once()
        org_ops.finish_member_add_after_commit.assert_awaited_once()
        assert org_ops.finish_member_add_after_commit.await_args.args[0].membership is membership

    async def test_id_path_joins_without_verifying_the_email(self) -> None:
        user = _user()
        org = _org()
        invitation = _invitation(org)
        org_ops = _org_ops()
        session = _session(user, invitation, org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit,
        ):
            await _accept_as_member(session, user, invitation_id=invitation.id)

        assert user.email_verified is False
        assert invitation.accepted_by_user_id == user.id
        (accepted,) = _audit_calls(audit, Action.AUTH_INVITATION_ACCEPTED)
        assert accepted["details"]["via"] == AcceptVia.ID
        session.commit.assert_awaited_once()

    async def test_id_lookup_is_scoped_to_the_callers_email(self) -> None:
        user = _user(email="Member@Acme.io")
        org = _org()
        invitation = _invitation(org)
        org_ops = _org_ops()
        session = _session(user, invitation, org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()),
        ):
            await _accept_as_member(session, user, invitation_id=invitation.id)

        lookup = session.execute.await_args_list[1].args[0]
        assert set(lookup.compile().params.values()) == {invitation.id, "member@acme.io"}

    async def test_token_for_another_address_is_refused(self) -> None:
        user = _user(email="someone-else@acme.io")
        org = _org()
        org_ops = _org_ops()
        session = _session(user, _invitation(org), org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(PermissionDeniedError, match="different email address"),
        ):
            await _accept_as_member(session, user, token=_TOKEN)

        org_ops.stage_member.assert_not_awaited()
        session.commit.assert_not_awaited()
        session.rollback.assert_awaited()

    async def test_id_for_another_address_reads_as_missing(self) -> None:
        user = _user(email="someone-else@acme.io")
        org_ops = _org_ops()
        session = _session(user, None)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(NotFoundError),
        ):
            await _accept_as_member(session, user, invitation_id=generate_id())

        org_ops.stage_member.assert_not_awaited()
        session.commit.assert_not_awaited()

    @pytest.mark.parametrize(
        ("fields", "error"),
        [
            ({"expires_at": datetime.now(UTC) - timedelta(seconds=1)}, InvitationExpiredError),
            ({"revoked_at": datetime.now(UTC)}, InvitationRevokedError),
            ({"accepted_at": datetime.now(UTC)}, InvitationAlreadyUsedError),
        ],
        ids=["expired", "revoked", "accepted"],
    )
    @pytest.mark.parametrize("lookup", ["token", "invitation_id"])
    async def test_an_unusable_invitation_is_refused(
        self, fields: dict[str, Any], error: type[Exception], lookup: str
    ) -> None:
        user = _user()
        org = _org()
        invitation = _invitation(org, **fields)
        org_ops = _org_ops()
        session = _session(user, invitation, org)
        value = _TOKEN if lookup == "token" else invitation.id

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(error),
        ):
            await _accept_as_member(session, user, **{lookup: value})

        org_ops.stage_member.assert_not_awaited()
        session.commit.assert_not_awaited()
        assert user.email_verified is False

    async def test_suspended_organization_is_refused(self) -> None:
        user = _user()
        org = _org(is_suspended=True)
        org_ops = _org_ops()
        session = _session(user, _invitation(org), org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(PermissionDeniedError, match="suspended"),
        ):
            await _accept_as_member(session, user, token=_TOKEN)

        org_ops.stage_member.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_deleted_organization_reads_as_missing(self) -> None:
        user = _user()
        org = _org(deleted_at=datetime.now(UTC))
        org_ops = _org_ops()
        session = _session(user, _invitation(org), org)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(InvitationNotFoundError),
        ):
            await _accept_as_member(session, user, token=_TOKEN)

        org_ops.stage_member.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_inactive_user_is_refused(self) -> None:
        user = _user(is_active=False)
        org_ops = _org_ops()
        session = _session(user)

        with (
            patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops),
            pytest.raises(PermissionDeniedError),
        ):
            await _accept_as_member(session, user, token=_TOKEN)

        assert session.execute.await_count == 1
        org_ops.stage_member.assert_not_awaited()

    @pytest.mark.parametrize(
        "lookup",
        [{}, {"token": _TOKEN, "invitation_id": generate_id()}],
        ids=["neither", "both"],
    )
    async def test_exactly_one_lookup_is_required(self, lookup: dict[str, Any]) -> None:
        session = _session()

        with pytest.raises(ValidationError) as refused:
            await _accept_as_member(session, _user(), **lookup)

        assert refused.value.field == "lookup"
        session.execute.assert_not_awaited()


class TestDecline:
    async def test_marks_the_invitation_declined_and_audits(self) -> None:
        user = _user()
        org = _org()
        invitation = _invitation(org)
        session = _session(user, invitation)

        with patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit:
            await InvitationOperations(session).decline(user_id=user.id, invitation_id=invitation.id)

        assert invitation.revoked_at is not None
        assert invitation.revoked_by_user_id == user.id
        (declined,) = _audit_calls(audit, Action.ORGANIZATION_INVITATION_DECLINED)
        assert declined["organization_id"] == org.id
        assert declined["actor_user_id"] == user.id
        assert declined["resource_type"] is AuditResourceType.INVITATION
        assert declined["resource_id"] == invitation.id
        session.commit.assert_awaited_once()

    async def test_declining_twice_changes_nothing(self) -> None:
        user = _user()
        revoked_at = datetime.now(UTC) - timedelta(hours=1)
        revoker = generate_id()
        invitation = _invitation(_org(), revoked_at=revoked_at, revoked_by_user_id=revoker)
        session = _session(user, invitation)

        with patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit:
            await InvitationOperations(session).decline(user_id=user.id, invitation_id=invitation.id)

        assert invitation.revoked_at == revoked_at
        assert invitation.revoked_by_user_id == revoker
        audit.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_a_stranger_gets_not_found(self) -> None:
        session = _session(_user(email="stranger@acme.io"), None)

        with (
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit,
            pytest.raises(NotFoundError),
        ):
            await InvitationOperations(session).decline(
                user_id=generate_id(), invitation_id=generate_id()
            )

        audit.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_an_accepted_invitation_cannot_be_declined(self) -> None:
        user = _user()
        invitation = _invitation(_org(), accepted_at=datetime.now(UTC))
        session = _session(user, invitation)

        with pytest.raises(InvitationAlreadyUsedError):
            await InvitationOperations(session).decline(user_id=user.id, invitation_id=invitation.id)

        assert invitation.revoked_at is None
        session.commit.assert_not_awaited()


@contextmanager
def _anonymous_flow(org_ops: MagicMock, staged_auth: object) -> Iterator[None]:
    with ExitStack() as stack:
        stack.enter_context(patch(f"{_MODULE}.OrganizationOperations", return_value=org_ops))
        stack.enter_context(patch(f"{_MODULE}.check_rate_limit", new=AsyncMock()))
        stack.enter_context(patch(f"{_MODULE}.client_ip_for_rate_limit", return_value=None))
        stack.enter_context(
            patch(
                f"{_MODULE}.stage_invitation_authentication",
                new=AsyncMock(return_value=staged_auth),
            )
        )
        yield


async def _accept_anonymously(
    session: MagicMock,
    *,
    username: str = "requested-name",
    full_name: str | None = None,
    search_indexer: MagicMock | None = None,
) -> object:
    return await InvitationOperations(session).accept(
        raw_token=_TOKEN,
        username=username,
        password=_PASSWORD,
        full_name=full_name,
        user_agent="pytest",
        search_indexer=search_indexer or MagicMock(),
    )


class TestAnonymousAccept:
    async def test_an_existing_account_must_sign_in_first(self) -> None:
        org = _org()
        invitation = _invitation(org)
        org_ops = _org_ops()
        # Order: invitation, its organization, an account holding the address.
        session = _session(invitation, org, generate_id())

        with (
            _anonymous_flow(org_ops, object()),
            patch(f"{_MODULE}.stage_invited_user", new=AsyncMock()) as create,
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit,
            pytest.raises(InvitationSignInRequiredError, match="Sign in to accept"),
        ):
            await _accept_anonymously(session)

        # The address alone decides; a deactivated account is never reopened by mail.
        lookup = session.execute.await_args_list[2].args[0]
        assert set(lookup.compile().params.values()) == {"member@acme.io"}
        create.assert_not_awaited()
        org_ops.stage_member.assert_not_awaited()
        audit.assert_not_awaited()
        session.add.assert_not_called()
        session.flush.assert_not_awaited()
        session.commit.assert_not_awaited()
        session.rollback.assert_awaited()
        assert invitation.accepted_at is None

    @pytest.mark.parametrize(
        ("fields", "error"),
        [
            ({"deleted_at": datetime.now(UTC)}, InvitationNotFoundError),
            ({"is_suspended": True}, PermissionDeniedError),
        ],
        ids=["deleted", "suspended"],
    )
    async def test_a_closed_organization_is_refused_before_any_write(
        self, fields: dict[str, Any], error: type[Exception]
    ) -> None:
        org = _org(**fields)
        invitation = _invitation(org)
        org_ops = _org_ops()
        session = _session(invitation, org)

        with (
            _anonymous_flow(org_ops, object()),
            patch(f"{_MODULE}.stage_invited_user", new=AsyncMock()) as create,
            patch(f"{_MODULE}.write_audit_event", new=AsyncMock()) as audit,
            pytest.raises(error),
        ):
            await _accept_anonymously(session)

        # The account lookup never runs, so a closed organization tells nothing about the address.
        assert session.execute.await_count == 2
        create.assert_not_awaited()
        org_ops.stage_member.assert_not_awaited()
        audit.assert_not_awaited()
        session.commit.assert_not_awaited()
        assert invitation.accepted_at is None


def _context(method: str) -> SimpleNamespace:
    return SimpleNamespace(
        method=SimpleNamespace(name=f"auth.v1.AuthService/{method}"),
        request_headers={"user-agent": "pytest"},
    )


@asynccontextmanager
async def _open_session():
    yield MagicMock()


@contextmanager
def _invitation_operations(ops: MagicMock) -> Iterator[None]:
    with (
        patch("uniffy.domains.auth.handlers.open_session", _open_session),
        patch("uniffy.domains.auth.handlers.InvitationOperations", return_value=ops),
    ):
        yield


def _auth_handlers() -> AuthHandlers:
    return AuthHandlers(search_indexer=MagicMock(), call_lifecycle=MagicMock())


class TestAcceptInvitationHandler:
    async def _answer(self, error: Exception) -> ConnectError:
        ops = MagicMock(accept=AsyncMock(side_effect=error))
        request = AcceptInvitationRequest(token=_TOKEN, username="u", password=_PASSWORD)
        with _invitation_operations(ops), pytest.raises(ConnectError) as refused:
            await LoggingInterceptor().intercept_unary(
                _auth_handlers().accept_invitation, request, _context("AcceptInvitation")
            )
        return refused.value

    async def test_sign_in_required_reaches_the_client_with_its_reason(self) -> None:
        error = await self._answer(
            InvitationSignInRequiredError("Sign in to accept this invitation")
        )

        reason = error_info_detail(SIGN_IN_REQUIRED_REASON)
        assert error.code is Code.FAILED_PRECONDITION
        assert error.message == "Sign in to accept this invitation"
        assert [(d.type_name, d.message_bytes) for d in error.details] == [
            (reason.type_name, reason.message_bytes)
        ]

    async def test_a_suspended_organization_answers_permission_denied(self) -> None:
        error = await self._answer(PermissionDeniedError("This organization is suspended"))

        assert error.code is Code.PERMISSION_DENIED
        assert "suspended" in error.message
        assert not error.details

    async def test_a_deleted_organization_answers_not_found(self) -> None:
        error = await self._answer(InvitationNotFoundError("Invitation not found"))

        assert error.code is Code.NOT_FOUND


class TestGetInvitationHandler:
    @pytest.mark.parametrize(
        ("error", "code"),
        [
            (PermissionDeniedError("This organization is suspended"), Code.PERMISSION_DENIED),
            (InvitationNotFoundError("Invitation not found"), Code.NOT_FOUND),
        ],
        ids=["suspended", "deleted"],
    )
    async def test_a_closed_organization_is_refused_with_its_code(
        self, error: Exception, code: Code
    ) -> None:
        ops = MagicMock(get_for_token=AsyncMock(side_effect=error))

        with _invitation_operations(ops), pytest.raises(ConnectError) as refused:
            await LoggingInterceptor().intercept_unary(
                _auth_handlers().get_invitation,
                GetInvitationRequest(token=_TOKEN),
                _context("GetInvitation"),
            )

        assert refused.value.code is code
        assert refused.value.message == str(error)
