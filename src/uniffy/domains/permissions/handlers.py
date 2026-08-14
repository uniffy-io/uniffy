"""Handlers for ``permissions.v1.MembersService``; delegate to ``ContentMembersOperations``."""

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

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import resolve_effective_policy
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
from uniffy.core.converters.proto import timestamp_to_datetime
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
    audit_action_for_member_action,
    audit_event_to_content_member_event_proto,
    content_access_policy_to_proto,
    content_member_to_proto,
)

logger = logger.bind(component="permissions.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _resolve_content_type(proto_type) -> ContentType:
    domain_type = content_type_from_proto(proto_type)
    if domain_type is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")
    return domain_type


def _resolve_subject_type(proto_type) -> SubjectType:
    domain_type = subject_type_from_proto(proto_type)
    if domain_type is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid subject type")
    return domain_type


def _resolve_role(proto_role) -> ContentRole:
    role = content_role_from_proto(proto_role)
    if role is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content role")
    return role


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.exception("Unhandled error in MembersService handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


async def _policy_for(
    session,
    *,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
):
    """Access-policy proto for content, including the caller's effective role.

    The caller role is resolved by the same `PermissionChecker` that gates the
    operations, so the client never recomputes permissions. Raises NOT_FOUND
    when the content row is missing.
    """
    loader = get_content_loader(content_type)
    content = await loader(session, organization_id, content_id)
    if content is None:
        raise ConnectError(Code.NOT_FOUND, "Content not found")
    checker = PermissionChecker(session)
    caller_role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=content.owner_id,
        access_mode=content.access_mode,
        baseline_role=content.baseline_role,
    )
    default_mode, default_baseline = await checker.get_org_defaults(
        organization_id, content_type
    )
    effective_mode, _ = resolve_effective_policy(
        content.access_mode, content.baseline_role, default_mode, default_baseline
    )
    return content_access_policy_to_proto(
        owner_id=content.owner_id,
        access_mode=content.access_mode,
        baseline_role=content.baseline_role,
        caller_role=caller_role,
        effective_access_mode=effective_mode,
    )


class MembersHandlers:
    async def list_members(
        self,
        request: ListMembersRequest,
        ctx: RequestContext,
    ) -> ListMembersResponse:
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

                policy = await _policy_for(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
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
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        subject_id = _parse_uuid(request.subject_id, "subject_id")
        content_type = _resolve_content_type(request.content_type)
        subject_type = _resolve_subject_type(request.subject_type)
        role = _resolve_role(request.role)

        expires_at = None
        if request.HasField("expires_at"):
            expires_at = timestamp_to_datetime(request.expires_at)

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
        """Proto ``ACCESS_MODE_UNSPECIFIED`` clears the per-item override;
        the row inherits from org defaults.
        """
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        content_id = _parse_uuid(request.content_id, "content_id")
        content_type = _resolve_content_type(request.content_type)

        new_access_mode: AccessMode | None = access_mode_from_proto(request.access_mode)

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

                return SetAccessModeResponse(
                    policy=await _policy_for(
                        session,
                        user_id=user_id,
                        organization_id=organization_id,
                        content_type=content_type,
                        content_id=content_id,
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

                return TransferOwnershipResponse(
                    policy=await _policy_for(
                        session,
                        user_id=user_id,
                        organization_id=organization_id,
                        content_type=content_type,
                        content_id=content_id,
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

        action_filter: str | None = None
        if request.action:
            domain_action = content_member_action_from_proto(request.action)
            if domain_action is not None:
                action_filter = audit_action_for_member_action(domain_action)

        after = None
        if request.HasField("after"):
            after = timestamp_to_datetime(request.after)
        before = None
        if request.HasField("before"):
            before = timestamp_to_datetime(request.before)

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
                response.events.extend(
                    audit_event_to_content_member_event_proto(event) for event in events
                )

                # Best-effort total derived from the page to avoid an extra count query.
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
