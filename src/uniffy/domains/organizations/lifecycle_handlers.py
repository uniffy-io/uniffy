"""Self-service RPCs for joining, creating, leaving, handing over and deleting an organization."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from protobuf import Oneof
from sqlalchemy import select
from uniffy_proto.organizations.v1.organizations_pb import (
    AcceptMyInvitationRequest,
    AcceptMyInvitationResponse,
    CreateOrganizationRequest,
    CreateOrganizationResponse,
    DeclineMyInvitationRequest,
    DeclineMyInvitationResponse,
    DeleteOrganizationRequest,
    DeleteOrganizationResponse,
    LeaveOrganizationRequest,
    LeaveOrganizationResponse,
    ListMyInvitationsRequest,
    ListMyInvitationsResponse,
    TransferOwnershipRequest,
    TransferOwnershipResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters import datetime_to_timestamp, member_info_to_proto
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.domains.calls.lifecycle import CallRevocationLifecycle
from uniffy.domains.organizations.converters import my_organization_to_proto
from uniffy.domains.organizations.creation import create_organization_for_user
from uniffy.domains.organizations.invitations import (
    InvitationAlreadyUsedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationOperations,
    InvitationRevokedError,
)
from uniffy.domains.organizations.invitations.converters import my_invitation_to_proto
from uniffy.domains.organizations.lifecycle import (
    delete_organization_by_owner,
    leave_organization,
    transfer_ownership,
)
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="organizations.lifecycle_handlers")

_ERROR_CODES: tuple[tuple[type[Exception] | tuple[type[Exception], ...], Code], ...] = (
    (ValidationError, Code.INVALID_ARGUMENT),
    (PermissionDeniedError, Code.PERMISSION_DENIED),
    ((NotFoundError, InvitationNotFoundError), Code.NOT_FOUND),
    (RateLimitExceededError, Code.RESOURCE_EXHAUSTED),
    (
        (InvitationExpiredError, InvitationRevokedError, InvitationAlreadyUsedError),
        Code.FAILED_PRECONDITION,
    ),
)


def _connect_error(error: Exception, failure: str) -> ConnectError:
    """Raise the result ``from error``: transport reads the chained cause for its typed reason."""
    if isinstance(error, ConnectError):
        return error
    for error_types, code in _ERROR_CODES:
        if isinstance(error, error_types):
            return ConnectError(code, str(error))
    logger.opt(exception=error).error(f"Error {failure}")
    return ConnectError(Code.INTERNAL, "Internal server error")


def _parse_id(raw: str, field: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}") from None


def _invitation_lookup(request: AcceptMyInvitationRequest) -> tuple[str | None, UUID | None]:
    match request.lookup:
        case Oneof(field="token", value=token) if token:
            return token, None
        case Oneof(field="invitation_id", value=raw_id):
            return None, _parse_id(raw_id, "invitation_id")
    raise ConnectError(Code.INVALID_ARGUMENT, "invitation_id or token is required")


class OrganizationLifecycleHandlers:
    search_indexer: SearchIndexer
    call_lifecycle: CallRevocationLifecycle

    async def create_organization(
        self,
        request: CreateOrganizationRequest,
        ctx: RequestContext,
    ) -> CreateOrganizationResponse:
        user_id = current_user_id()
        try:
            async with open_session() as session:
                org, membership = await create_organization_for_user(
                    session,
                    user_id=user_id,
                    name=request.name,
                    slug=request.slug if request.has_field("slug") else None,
                    search_indexer=self.search_indexer,
                )
                return CreateOrganizationResponse(
                    organization=my_organization_to_proto(org, membership)
                )
        except Exception as e:
            raise _connect_error(e, "creating organization") from e

    async def list_my_invitations(
        self,
        request: ListMyInvitationsRequest,
        ctx: RequestContext,
    ) -> ListMyInvitationsResponse:
        user_id = current_user_id()
        try:
            async with open_session() as session:
                rows = await InvitationOperations(session).list_for_user(user_id)
                return ListMyInvitationsResponse(
                    invitations=[my_invitation_to_proto(row) for row in rows]
                )
        except Exception as e:
            raise _connect_error(e, "listing own invitations") from e

    async def accept_my_invitation(
        self,
        request: AcceptMyInvitationRequest,
        ctx: RequestContext,
    ) -> AcceptMyInvitationResponse:
        user_id = current_user_id()
        token, invitation_id = _invitation_lookup(request)
        try:
            async with open_session() as session:
                org, membership = await InvitationOperations(session).accept_as_member(
                    user_id=user_id,
                    token=token,
                    invitation_id=invitation_id,
                    search_indexer=self.search_indexer,
                )
                return AcceptMyInvitationResponse(
                    organization=my_organization_to_proto(org, membership)
                )
        except Exception as e:
            raise _connect_error(e, "accepting own invitation") from e

    async def decline_my_invitation(
        self,
        request: DeclineMyInvitationRequest,
        ctx: RequestContext,
    ) -> DeclineMyInvitationResponse:
        user_id = current_user_id()
        invitation_id = _parse_id(request.invitation_id, "invitation_id")
        try:
            async with open_session() as session:
                await InvitationOperations(session).decline(
                    user_id=user_id, invitation_id=invitation_id
                )
        except Exception as e:
            raise _connect_error(e, "declining own invitation") from e
        return DeclineMyInvitationResponse()

    async def leave_organization(
        self,
        request: LeaveOrganizationRequest,
        ctx: RequestContext,
    ) -> LeaveOrganizationResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                await leave_organization(
                    session,
                    user_id=user_id,
                    org_id=org_id,
                    search_indexer=self.search_indexer,
                    call_lifecycle=self.call_lifecycle,
                )
        except Exception as e:
            raise _connect_error(e, "leaving organization") from e
        return LeaveOrganizationResponse()

    async def transfer_ownership(
        self,
        request: TransferOwnershipRequest,
        ctx: RequestContext,
    ) -> TransferOwnershipResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        new_owner_user_id = _parse_id(request.new_owner_user_id, "new_owner_user_id")
        try:
            async with open_session() as session:
                new_owner, previous_owner = await transfer_ownership(
                    session,
                    owner_user_id=user_id,
                    org_id=org_id,
                    new_owner_user_id=new_owner_user_id,
                )
                users = {
                    user.id: user
                    for user in (
                        await session.execute(
                            select(User).where(User.id.in_([user_id, new_owner_user_id]))
                        )
                    ).scalars()
                }
                return TransferOwnershipResponse(
                    new_owner=member_info_to_proto(users[new_owner_user_id], new_owner),
                    previous_owner=member_info_to_proto(users[user_id], previous_owner),
                )
        except Exception as e:
            raise _connect_error(e, "transferring organization ownership") from e

    async def delete_organization(
        self,
        request: DeleteOrganizationRequest,
        ctx: RequestContext,
    ) -> DeleteOrganizationResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                purge_at = await delete_organization_by_owner(
                    session,
                    user_id=user_id,
                    org_id=org_id,
                    confirm_slug=request.confirm_slug,
                    call_lifecycle=self.call_lifecycle,
                )
        except Exception as e:
            raise _connect_error(e, "deleting organization") from e
        return DeleteOrganizationResponse(purge_at=datetime_to_timestamp(purge_at))
