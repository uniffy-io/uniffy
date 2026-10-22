"""OrganizationsService self-service handlers: Connect codes, oneof dispatch and org-less tokens."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from protobuf import Oneof
from uniffy_proto.organizations.v1.organizations_pb import (
    AcceptMyInvitationRequest,
    CreateOrganizationRequest,
    DeclineMyInvitationRequest,
    DeleteOrganizationRequest,
    InviteMemberRequest,
    LeaveOrganizationRequest,
    ListMyInvitationsRequest,
    ListMyOrganizationsRequest,
    TransferOwnershipRequest,
    UpdateOrganizationRequest,
)

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.converters import datetime_to_timestamp, org_role_to_proto
from uniffy.core.errors import (
    ConflictError,
    MembershipRequiredError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.organizations.invitations import (
    InvitationAlreadyUsedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationRevokedError,
    MyInvitationRow,
)
from uniffy.domains.organizations.service import OrganizationsServiceImpl
from uniffy.transport.rpc import ERROR_INFO_DOMAIN, MEMBERSHIP_REQUIRED_REASON, LoggingInterceptor

_HANDLERS = "uniffy.domains.organizations.handlers"
_LIFECYCLE = "uniffy.domains.organizations.lifecycle_handlers"


@contextmanager
def _signed_in(user_id: UUID, organization_id: UUID | None = None) -> Iterator[None]:
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user_id,
            organization_id=organization_id,
            session_id=None,
            token_version=None,
            full_name="",
            avatar_key="",
        )
    )
    try:
        yield
    finally:
        reset_current_principal(token)


def _open_session(session: object):
    @asynccontextmanager
    async def fake_open_session() -> AsyncIterator[object]:
        yield session

    return fake_open_session


def _service() -> OrganizationsServiceImpl:
    return OrganizationsServiceImpl(MagicMock(), MagicMock())


def _org() -> Organization:
    return Organization(id=generate_id(), name="Acme", slug="acme", plan="free")


def _membership(org: Organization, user_id: UUID, role: OrganizationRole) -> OrganizationMember:
    return OrganizationMember(user_id=user_id, organization_id=org.id, role=role)


def _user(user_id: UUID) -> User:
    return User(
        id=user_id,
        email=f"{user_id.hex[:8]}@example.com",
        username=user_id.hex[:12],
        full_name="Pat Doe",
        hashed_password="x",
    )


async def _refusal(call) -> ConnectError:
    with pytest.raises(ConnectError) as refused:
        await call
    return refused.value


_DOMAIN_CODES = [
    (ValidationError("slug", "Slug is already in use"), Code.INVALID_ARGUMENT),
    (PermissionDeniedError("Organization creation is not allowed"), Code.PERMISSION_DENIED),
    (MembershipRequiredError("Requires organization membership"), Code.PERMISSION_DENIED),
    (NotFoundError("User", "x"), Code.NOT_FOUND),
    (RateLimitExceededError("organization creation", 5, 3600), Code.RESOURCE_EXHAUSTED),
]

_INVITATION_CODES = [
    (InvitationExpiredError("Invitation has expired"), Code.FAILED_PRECONDITION),
    (InvitationRevokedError("Invitation has been revoked"), Code.FAILED_PRECONDITION),
    (InvitationAlreadyUsedError("Invitation has already been accepted"), Code.FAILED_PRECONDITION),
    (InvitationNotFoundError("Invitation not found"), Code.NOT_FOUND),
    (NotFoundError("Invitation", "x"), Code.NOT_FOUND),
    (
        PermissionDeniedError("This invitation was sent to a different address"),
        Code.PERMISSION_DENIED,
    ),
]


class TestCreateOrganization:
    @pytest.mark.parametrize(("request_slug", "expected_slug"), [(None, None), ("acme", "acme")])
    async def test_an_org_less_token_creates_and_gets_its_membership(
        self, request_slug: str | None, expected_slug: str | None
    ) -> None:
        user_id = generate_id()
        org = _org()
        create = AsyncMock(return_value=(org, _membership(org, user_id, OrganizationRole.OWNER)))
        service = _service()
        request = CreateOrganizationRequest(name="Acme")
        if request_slug is not None:
            request.slug = request_slug

        with (
            _signed_in(user_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.create_organization_for_user", create),
        ):
            response = await service.create_organization(request, MagicMock())

        assert response.organization.organization.id == str(org.id)
        assert response.organization.role == org_role_to_proto(OrganizationRole.OWNER)
        assert create.await_args.kwargs == {
            "user_id": user_id,
            "name": "Acme",
            "slug": expected_slug,
            "search_indexer": service.search_indexer,
        }

    @pytest.mark.parametrize(("error", "code"), _DOMAIN_CODES)
    async def test_domain_refusals_keep_their_code(self, error: Exception, code: Code) -> None:
        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.create_organization_for_user", AsyncMock(side_effect=error)),
        ):
            refused = await _refusal(
                _service().create_organization(CreateOrganizationRequest(name="Acme"), MagicMock())
            )

        assert refused.code is code
        assert refused.message == str(error)

    async def test_an_unexpected_failure_hides_its_text(self) -> None:
        failure = RuntimeError("password=hunter2")

        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.create_organization_for_user", AsyncMock(side_effect=failure)),
        ):
            refused = await _refusal(
                _service().create_organization(CreateOrganizationRequest(name="Acme"), MagicMock())
            )

        assert (refused.code, refused.message) == (Code.INTERNAL, "Internal server error")


class TestMyInvitations:
    async def test_listing_works_without_an_organization(self) -> None:
        user_id = generate_id()
        org = _org()
        inviter = _user(generate_id())
        invitation = Invitation(
            organization_id=org.id,
            email="me@example.com",
            role=OrganizationRole.ADMIN,
            invited_by_user_id=inviter.id,
            token_hash="hash",
            expires_at=datetime.now(UTC) + timedelta(days=3),
        )
        operations = MagicMock(
            list_for_user=AsyncMock(return_value=[MyInvitationRow(invitation, org, inviter)])
        )

        with (
            _signed_in(user_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            response = await _service().list_my_invitations(ListMyInvitationsRequest(), MagicMock())

        operations.list_for_user.assert_awaited_once_with(user_id)
        [listed] = response.invitations
        assert listed.id == str(invitation.id)
        assert listed.organization.slug == "acme"
        assert listed.inviter_display_name == "Pat Doe"

    @pytest.mark.parametrize("field", ["token", "invitation_id"])
    async def test_accept_dispatches_on_the_lookup(self, field: str) -> None:
        user_id = generate_id()
        org = _org()
        invitation_id = generate_id()
        if field == "token":
            lookup = Oneof(field="token", value="raw-token")
            expected = {"token": "raw-token", "invitation_id": None}
        else:
            lookup = Oneof(field="invitation_id", value=str(invitation_id))
            expected = {"token": None, "invitation_id": invitation_id}
        operations = MagicMock(
            accept_as_member=AsyncMock(
                return_value=(org, _membership(org, user_id, OrganizationRole.MEMBER))
            )
        )
        service = _service()

        with (
            _signed_in(user_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            response = await service.accept_my_invitation(
                AcceptMyInvitationRequest(lookup=lookup), MagicMock()
            )

        assert response.organization.organization.id == str(org.id)
        assert response.organization.role == org_role_to_proto(OrganizationRole.MEMBER)
        assert operations.accept_as_member.await_args.kwargs == {
            "user_id": user_id,
            "search_indexer": service.search_indexer,
            **expected,
        }

    @pytest.mark.parametrize(
        "lookup",
        [None, Oneof(field="token", value=""), Oneof(field="invitation_id", value="nope")],
    )
    async def test_accept_needs_a_usable_lookup(self, lookup: Oneof | None) -> None:
        operations = MagicMock(accept_as_member=AsyncMock())

        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            refused = await _refusal(
                _service().accept_my_invitation(
                    AcceptMyInvitationRequest(lookup=lookup), MagicMock()
                )
            )

        assert refused.code is Code.INVALID_ARGUMENT
        operations.accept_as_member.assert_not_awaited()

    @pytest.mark.parametrize(("error", "code"), _INVITATION_CODES)
    async def test_accept_maps_invitation_states(self, error: Exception, code: Code) -> None:
        operations = MagicMock(accept_as_member=AsyncMock(side_effect=error))

        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            refused = await _refusal(
                _service().accept_my_invitation(
                    AcceptMyInvitationRequest(lookup=Oneof(field="token", value="raw")),
                    MagicMock(),
                )
            )

        assert refused.code is code

    async def test_decline_works_without_an_organization(self) -> None:
        user_id = generate_id()
        invitation_id = generate_id()
        operations = MagicMock(decline=AsyncMock())

        with (
            _signed_in(user_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            await _service().decline_my_invitation(
                DeclineMyInvitationRequest(invitation_id=str(invitation_id)), MagicMock()
            )

        operations.decline.assert_awaited_once_with(user_id=user_id, invitation_id=invitation_id)

    async def test_decline_rejects_a_malformed_id(self) -> None:
        operations = MagicMock(decline=AsyncMock())

        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            refused = await _refusal(
                _service().decline_my_invitation(
                    DeclineMyInvitationRequest(invitation_id="not-a-uuid"), MagicMock()
                )
            )

        assert refused.code is Code.INVALID_ARGUMENT
        operations.decline.assert_not_awaited()

    @pytest.mark.parametrize(("error", "code"), _INVITATION_CODES)
    async def test_decline_maps_invitation_states(self, error: Exception, code: Code) -> None:
        operations = MagicMock(decline=AsyncMock(side_effect=error))

        with (
            _signed_in(generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.InvitationOperations", return_value=operations),
        ):
            refused = await _refusal(
                _service().decline_my_invitation(
                    DeclineMyInvitationRequest(invitation_id=str(generate_id())), MagicMock()
                )
            )

        assert refused.code is code


class TestLeave:
    async def test_leave_targets_the_token_organization(self) -> None:
        user_id = generate_id()
        org_id = generate_id()
        leave = AsyncMock()
        session = MagicMock()
        service = _service()

        with (
            _signed_in(user_id, org_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(session)),
            patch(f"{_LIFECYCLE}.leave_organization", leave),
        ):
            await service.leave_organization(LeaveOrganizationRequest(), MagicMock())

        leave.assert_awaited_once_with(
            session,
            user_id=user_id,
            org_id=org_id,
            search_indexer=service.search_indexer,
            call_lifecycle=service.call_lifecycle,
        )

    @pytest.mark.parametrize(
        ("token_org", "request_org", "code"),
        [
            (None, "", Code.INVALID_ARGUMENT),
            (UUID(int=1), str(UUID(int=2)), Code.PERMISSION_DENIED),
            (None, "not-a-uuid", Code.INVALID_ARGUMENT),
        ],
        ids=["org-less-token", "other-organization", "malformed-id"],
    )
    async def test_the_organization_must_match_the_token(
        self, token_org: UUID | None, request_org: str, code: Code
    ) -> None:
        leave = AsyncMock()

        with (
            _signed_in(generate_id(), token_org),
            patch(f"{_LIFECYCLE}.leave_organization", leave),
        ):
            refused = await _refusal(
                _service().leave_organization(
                    LeaveOrganizationRequest(organization_id=request_org), MagicMock()
                )
            )

        assert refused.code is code
        leave.assert_not_awaited()

    async def test_a_lost_membership_carries_the_typed_reason(self) -> None:
        user_id = generate_id()
        org_id = generate_id()
        refusal = MembershipRequiredError("Requires organization membership")
        service = _service()
        context = SimpleNamespace(method=SimpleNamespace(name="test/leave_organization"))

        with (
            _signed_in(user_id, org_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.leave_organization", AsyncMock(side_effect=refusal)),
        ):
            refused = await _refusal(
                LoggingInterceptor().intercept_unary(
                    service.leave_organization, LeaveOrganizationRequest(), context
                )
            )

        assert refused.code is Code.PERMISSION_DENIED
        [detail] = refused.details
        reason, domain = MEMBERSHIP_REQUIRED_REASON.encode(), ERROR_INFO_DOMAIN.encode()
        assert detail.message_bytes == (
            bytes([0x0A, len(reason)]) + reason + bytes([0x12, len(domain)]) + domain
        )

    async def test_an_owner_is_refused(self) -> None:
        refusal = PermissionDeniedError("Transfer ownership before leaving the organization")

        with (
            _signed_in(generate_id(), generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.leave_organization", AsyncMock(side_effect=refusal)),
        ):
            refused = await _refusal(
                _service().leave_organization(LeaveOrganizationRequest(), MagicMock())
            )

        assert refused.code is Code.PERMISSION_DENIED
        assert refused.message == str(refusal)


class TestTransfer:
    async def test_both_members_come_back(self) -> None:
        org = _org()
        owner = _user(generate_id())
        target = _user(generate_id())
        new_owner = _membership(org, target.id, OrganizationRole.OWNER)
        previous_owner = _membership(org, owner.id, OrganizationRole.ADMIN)
        transfer = AsyncMock(return_value=(new_owner, previous_owner))
        session = MagicMock()
        session.execute = AsyncMock(
            return_value=MagicMock(scalars=MagicMock(return_value=[owner, target]))
        )

        with (
            _signed_in(owner.id, org.id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(session)),
            patch(f"{_LIFECYCLE}.transfer_ownership", transfer),
        ):
            response = await _service().transfer_ownership(
                TransferOwnershipRequest(
                    organization_id=str(org.id), new_owner_user_id=str(target.id)
                ),
                MagicMock(),
            )

        transfer.assert_awaited_once_with(
            session, owner_user_id=owner.id, org_id=org.id, new_owner_user_id=target.id
        )
        assert response.new_owner.user_id == str(target.id)
        assert response.previous_owner.user_id == str(owner.id)
        assert response.new_owner.role != response.previous_owner.role

    @pytest.mark.parametrize(
        ("new_owner", "error", "code"),
        [
            ("not-a-uuid", None, Code.INVALID_ARGUMENT),
            (None, ValidationError("new_owner_user_id", "Already the owner"), Code.INVALID_ARGUMENT),
            (None, NotFoundError("Member", "x"), Code.NOT_FOUND),
            (None, PermissionDeniedError("Requires organization owner"), Code.PERMISSION_DENIED),
        ],
    )
    async def test_refusals(
        self, new_owner: str | None, error: Exception | None, code: Code
    ) -> None:
        org_id = generate_id()
        transfer = AsyncMock(side_effect=error)

        with (
            _signed_in(generate_id(), org_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.transfer_ownership", transfer),
        ):
            refused = await _refusal(
                _service().transfer_ownership(
                    TransferOwnershipRequest(
                        organization_id=str(org_id),
                        new_owner_user_id=new_owner or str(generate_id()),
                    ),
                    MagicMock(),
                )
            )

        assert refused.code is code
        if error is None:
            transfer.assert_not_awaited()


class TestDelete:
    async def test_returns_the_purge_time(self) -> None:
        user_id = generate_id()
        org_id = generate_id()
        purge_at = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
        delete = AsyncMock(return_value=purge_at)
        session = MagicMock()
        service = _service()

        with (
            _signed_in(user_id, org_id),
            patch(f"{_LIFECYCLE}.open_session", _open_session(session)),
            patch(f"{_LIFECYCLE}.delete_organization_by_owner", delete),
        ):
            response = await service.delete_organization(
                DeleteOrganizationRequest(organization_id=str(org_id), confirm_slug="acme"),
                MagicMock(),
            )

        assert response.purge_at == datetime_to_timestamp(purge_at)
        delete.assert_awaited_once_with(
            session,
            user_id=user_id,
            org_id=org_id,
            confirm_slug="acme",
            call_lifecycle=service.call_lifecycle,
        )

    @pytest.mark.parametrize(
        ("error", "code"),
        [
            (
                ValidationError("confirm_slug", "Confirmation slug does not match"),
                Code.INVALID_ARGUMENT,
            ),
            (
                PermissionDeniedError("Requires organization owner privileges"),
                Code.PERMISSION_DENIED,
            ),
            (RuntimeError("boom"), Code.INTERNAL),
        ],
    )
    async def test_refusals(self, error: Exception, code: Code) -> None:
        with (
            _signed_in(generate_id(), generate_id()),
            patch(f"{_LIFECYCLE}.open_session", _open_session(MagicMock())),
            patch(f"{_LIFECYCLE}.delete_organization_by_owner", AsyncMock(side_effect=error)),
        ):
            refused = await _refusal(
                _service().delete_organization(
                    DeleteOrganizationRequest(confirm_slug="acme"), MagicMock()
                )
            )

        assert refused.code is code


class TestListMyOrganizations:
    @pytest.mark.parametrize("allowed", [True, False])
    async def test_reports_whether_the_caller_may_create(self, allowed: bool) -> None:
        user = _user(generate_id())
        org = _org()
        operations = MagicMock(
            get_user_organizations=AsyncMock(
                return_value=[(org, _membership(org, user.id, OrganizationRole.MEMBER))]
            )
        )
        session = MagicMock()
        session.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=user))
        )
        policy = AsyncMock(return_value=allowed)

        with (
            _signed_in(user.id),
            patch(f"{_HANDLERS}.open_session", _open_session(session)),
            patch(f"{_HANDLERS}.OrganizationOperations", return_value=operations),
            patch(f"{_HANDLERS}.user_can_create_organization", policy),
        ):
            response = await _service().list_my_organizations(
                ListMyOrganizationsRequest(), MagicMock()
            )

        assert response.can_create_organization is allowed
        assert [item.organization.id for item in response.organizations] == [str(org.id)]
        policy.assert_awaited_once_with(session, user)

    async def test_a_missing_account_may_not_create(self) -> None:
        operations = MagicMock(get_user_organizations=AsyncMock(return_value=[]))
        session = MagicMock()
        session.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        policy = AsyncMock(return_value=True)

        with (
            _signed_in(generate_id()),
            patch(f"{_HANDLERS}.open_session", _open_session(session)),
            patch(f"{_HANDLERS}.OrganizationOperations", return_value=operations),
            patch(f"{_HANDLERS}.user_can_create_organization", policy),
        ):
            response = await _service().list_my_organizations(
                ListMyOrganizationsRequest(), MagicMock()
            )

        assert response.can_create_organization is False
        policy.assert_not_awaited()


class TestInviteMember:
    async def test_every_invite_returns_the_pending_invitation(self) -> None:
        inviter = _user(generate_id())
        org_id = generate_id()
        invitation = Invitation(
            organization_id=org_id,
            email="new@example.com",
            role=OrganizationRole.MEMBER,
            invited_by_user_id=inviter.id,
            token_hash="hash",
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
        operations = MagicMock(invite=AsyncMock(return_value=SimpleNamespace(invitation=invitation)))
        session = MagicMock()
        session.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=inviter))
        )

        with (
            _signed_in(inviter.id, org_id),
            patch(f"{_HANDLERS}.open_session", _open_session(session)),
            patch(f"{_HANDLERS}.InvitationOperations", return_value=operations),
        ):
            response = await _service().invite_member(
                InviteMemberRequest(email="new@example.com"), MagicMock()
            )

        operations.invite.assert_awaited_once_with(
            org_id=org_id,
            email="new@example.com",
            role=OrganizationRole.MEMBER,
            inviter_id=inviter.id,
        )
        assert response.invitation.id == str(invitation.id)
        assert response.invitation.email == "new@example.com"
        assert response.invitation.invited_by_display_name == "Pat Doe"

    async def test_an_active_member_answers_already_exists(self) -> None:
        conflict = ConflictError(
            "Organization member", "This person is already a member of the organization"
        )
        operations = MagicMock(invite=AsyncMock(side_effect=conflict))
        org_id = generate_id()

        with (
            _signed_in(generate_id(), org_id),
            patch(f"{_HANDLERS}.open_session", _open_session(MagicMock())),
            patch(f"{_HANDLERS}.InvitationOperations", return_value=operations),
        ):
            error = await _refusal(
                _service().invite_member(
                    InviteMemberRequest(email="member@example.com"), MagicMock()
                )
            )

        assert error.code is Code.ALREADY_EXISTS
        assert error.message == str(conflict)


class TestUpdateOrganization:
    async def test_an_org_admin_changes_only_name_and_slug(self) -> None:
        user_id = generate_id()
        org = _org()
        operations = MagicMock(require_org_admin=AsyncMock(), update=AsyncMock(return_value=org))

        with (
            _signed_in(user_id, org.id),
            patch(f"{_HANDLERS}.open_session", _open_session(MagicMock())),
            patch(f"{_HANDLERS}.OrganizationOperations", return_value=operations),
        ):
            response = await _service().update_organization(
                UpdateOrganizationRequest(name="Acme Labs"), MagicMock()
            )

        operations.require_org_admin.assert_awaited_once_with(user_id, org.id)
        operations.update.assert_awaited_once_with(
            org_id=org.id, name="Acme Labs", slug=None, actor_user_id=user_id
        )
        assert response.organization.id == str(org.id)
