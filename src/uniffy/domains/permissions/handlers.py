"""Handlers for ``permissions.v1.MembersService``.

Thin RPC layer that delegates to the generic
:class:`~uniffy.core.content.members.ContentMembersOperations`. Each
handler:

1. Extracts the user id from the JWT context.
2. Parses the request fields into domain types.
3. Opens an async session and calls the appropriate operations method.
4. Maps the result back to the proto response.

The generic operations class enforces all permission rules, writes audit
log rows, syncs the search index, and emits notifications. The handlers
do not duplicate any of that logic.
"""

from math import ceil
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.common.v1.common_pb2 import PaginationResponse
from uniffy_proto.permissions.v1.permissions_pb2 import (
    AddMemberRequest,
    AddMemberResponse,
    ListMemberEventsRequest,
    ListMemberEventsResponse,
    ListMembersRequest,
    ListMembersResponse,
    RemoveMemberRequest,
    RemoveMemberResponse,
    SetAccessModeRequest,
    SetAccessModeResponse,
    TransferOwnershipRequest,
    TransferOwnershipResponse,
    UpdateMemberRoleRequest,
    UpdateMemberRoleResponse,
)

from uniffy.core.content.members import (
    ContentMembersOperations,
    get_content_loader,
)
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_member_action_from_proto,
    content_role_from_proto,
    content_type_from_proto,
    subject_type_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.permissions.converters import (
    content_access_policy_to_proto,
    content_member_event_to_proto,
    content_member_to_proto,
)


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise INVALID_ARGUMENT."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _resolve_content_type(proto_type) -> ContentType:
    """Translate proto ContentType to domain enum or raise."""
    domain_type = content_type_from_proto(proto_type)
    if domain_type is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")
    return domain_type


def _resolve_subject_type(proto_type) -> SubjectType:
    """Translate proto SubjectType to domain enum or raise."""
    domain_type = subject_type_from_proto(proto_type)
    if domain_type is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid subject type")
    return domain_type


def _resolve_role(proto_role) -> ContentRole:
    """Translate proto ContentRole to domain enum or raise."""
    role = content_role_from_proto(proto_role)
    if role is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content role")
    return role


def _resolve_access_mode(proto_mode) -> AccessMode:
    """Translate proto AccessMode to domain enum or raise."""
    mode = access_mode_from_proto(proto_mode)
    if mode is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid access mode")
    return mode


def _map_domain_error(exc: Exception) -> ConnectError:
    """Convert a domain error into a ConnectError with the right code."""
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.error("Unhandled error in MembersService handler", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class MembersHandlers:
    """RPC handlers for ``permissions.v1.MembersService``."""

    async def list_members(
        self,
        request: ListMembersRequest,
        ctx: RequestContext,
    ) -> ListMembersResponse:
        """List explicit members and the access policy of a content item."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        content_type = _resolve_content_type(request.content_type)

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                members = await ops.list_members(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                )

                # Reload the content via the registered loader so we can
                # return the access policy alongside the member list.
                loader = get_content_loader(content_type)
                content = await loader(session, organization_id, content_id)
                if content is None:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                policy = content_access_policy_to_proto(
                    owner_id=content.owner_id,
                    access_mode=content.access_mode,
                    baseline_role=content.baseline_role,
                )
                response = ListMembersResponse(policy=policy)
                response.members.extend(content_member_to_proto(m) for m in members)
                return response
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def add_member(
        self,
        request: AddMemberRequest,
        ctx: RequestContext,
    ) -> AddMemberResponse:
        """Add a new explicit member to a content item."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        subject_id = _parse_uuid(request.subject_id, "subject_id")
        content_type = _resolve_content_type(request.content_type)
        subject_type = _resolve_subject_type(request.subject_type)
        role = _resolve_role(request.role)

        expires_at = None
        if request.HasField("expires_at"):
            expires_at = request.expires_at.ToDatetime()

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                member = await ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    role=role,
                    expires_at=expires_at,
                    note=request.note,
                )
                return AddMemberResponse(member=content_member_to_proto(member))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def update_member_role(
        self,
        request: UpdateMemberRoleRequest,
        ctx: RequestContext,
    ) -> UpdateMemberRoleResponse:
        """Change the role of an existing explicit member."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        subject_id = _parse_uuid(request.subject_id, "subject_id")
        content_type = _resolve_content_type(request.content_type)
        subject_type = _resolve_subject_type(request.subject_type)
        new_role = _resolve_role(request.new_role)

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                member = await ops.update_member_role(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    new_role=new_role,
                    note=request.note,
                )
                return UpdateMemberRoleResponse(member=content_member_to_proto(member))
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def remove_member(
        self,
        request: RemoveMemberRequest,
        ctx: RequestContext,
    ) -> RemoveMemberResponse:
        """Remove an explicit member from a content item."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        subject_id = _parse_uuid(request.subject_id, "subject_id")
        content_type = _resolve_content_type(request.content_type)
        subject_type = _resolve_subject_type(request.subject_type)

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                await ops.remove_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    note=request.note,
                )
                return RemoveMemberResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def set_access_mode(
        self,
        request: SetAccessModeRequest,
        ctx: RequestContext,
    ) -> SetAccessModeResponse:
        """Change the access mode and/or baseline role of a content item."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        content_type = _resolve_content_type(request.content_type)
        new_access_mode = _resolve_access_mode(request.access_mode)

        baseline_role = None
        if request.baseline_role:
            baseline_role = _resolve_role(request.baseline_role)

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                await ops.set_access_mode(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    new_access_mode=new_access_mode,
                    new_baseline_role=baseline_role,
                    remove_members_on_narrow=request.remove_members_on_narrow,
                    note=request.note,
                )

                # Reload the content row to return the latest policy
                loader = get_content_loader(content_type)
                content = await loader(session, organization_id, content_id)
                if content is None:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                return SetAccessModeResponse(
                    policy=content_access_policy_to_proto(
                        owner_id=content.owner_id,
                        access_mode=content.access_mode,
                        baseline_role=content.baseline_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def transfer_ownership(
        self,
        request: TransferOwnershipRequest,
        ctx: RequestContext,
    ) -> TransferOwnershipResponse:
        """Transfer ownership to another user."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        new_owner_user_id = _parse_uuid(request.new_owner_user_id, "new_owner_user_id")
        content_type = _resolve_content_type(request.content_type)

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                await ops.transfer_ownership(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    new_owner_user_id=new_owner_user_id,
                    note=request.note,
                )

                loader = get_content_loader(content_type)
                content = await loader(session, organization_id, content_id)
                if content is None:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                return TransferOwnershipResponse(
                    policy=content_access_policy_to_proto(
                        owner_id=content.owner_id,
                        access_mode=content.access_mode,
                        baseline_role=content.baseline_role,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

    async def list_member_events(
        self,
        request: ListMemberEventsRequest,
        ctx: RequestContext,
    ) -> ListMemberEventsResponse:
        """List the audit log entries for a content item."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        content_type = _resolve_content_type(request.content_type)

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            if request.pagination.page > 0:
                page = request.pagination.page
            if request.pagination.page_size > 0:
                page_size = min(request.pagination.page_size, 200)

        actor_filter_user_id = None
        if request.actor_user_id:
            actor_filter_user_id = _parse_uuid(request.actor_user_id, "actor_user_id")

        action_filter = None
        if request.action:
            action_filter = content_member_action_from_proto(request.action)

        after = None
        if request.HasField("after"):
            after = request.after.ToDatetime()
        before = None
        if request.HasField("before"):
            before = request.before.ToDatetime()

        offset = (page - 1) * page_size

        try:
            async with open_session() as session:
                ops = ContentMembersOperations(session)
                events = await ops.list_member_events(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    limit=page_size,
                    offset=offset,
                    actor_filter_user_id=actor_filter_user_id,
                    action_filter=action_filter,
                    after=after,
                    before=before,
                )

                response = ListMemberEventsResponse()
                response.events.extend(content_member_event_to_proto(event) for event in events)

                # Pagination response: total_count is unknown without an
                # extra count query, so we report the page contents and a
                # best-effort total based on whether the page was full.
                approx_total = offset + len(events)
                total_pages = max(1, ceil(approx_total / page_size)) if page_size else 1
                response.pagination.CopyFrom(
                    PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=approx_total,
                        total_pages=total_pages,
                    )
                )
                return response
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
