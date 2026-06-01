"""RPC handlers for ``superadmin.v1`` directory services;
``is_system_admin`` enforcement lives in operations.
"""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_directory_pb2 import (
    DeleteOrganizationRequest,
    DeleteOrganizationResponse,
    ForceLogoutUserRequest,
    ForceLogoutUserResponse,
    GetOrganizationRequest,
    GetOrganizationResponse,
    GetUserRequest,
    GetUserResponse,
    ListOrganizationsRequest,
    ListOrganizationsResponse,
    ListUsersRequest,
    ListUsersResponse,
    RestoreOrganizationRequest,
    RestoreOrganizationResponse,
    SetSystemAdminRequest,
    SetSystemAdminResponse,
    SuspendOrganizationRequest,
    SuspendOrganizationResponse,
    UnsuspendOrganizationRequest,
    UnsuspendOrganizationResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.platform.directory.converters import (
    org_detail_to_proto,
    org_summary_to_proto,
    user_detail_to_proto,
    user_summary_to_proto,
)
from uniffy.domains.platform.directory.operations import (
    PlatformDirectoryOperations,
)

logger = logger.bind(component="platform.directory.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    if not value:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is required")
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is not a valid UUID") from exc


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ValueError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.exception("Unhandled error in platform directory handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


class SystemOrganizationsHandlers:
    async def list_organizations(
        self, request: ListOrganizationsRequest, ctx: RequestContext
    ) -> ListOrganizationsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                page = await PlatformDirectoryOperations(session).list_organizations(
                    user_id=user_id,
                    page=request.page,
                    page_size=request.page_size,
                    search=request.search,
                    include_deleted=request.include_deleted,
                    only_suspended=request.only_suspended,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListOrganizationsResponse(
            organizations=[org_summary_to_proto(r) for r in page.rows],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def get_organization(
        self, request: GetOrganizationRequest, ctx: RequestContext
    ) -> GetOrganizationResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(session).get_organization(
                    user_id=user_id, organization_id=org_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetOrganizationResponse(organization=org_detail_to_proto(detail))

    async def suspend_organization(
        self, request: SuspendOrganizationRequest, ctx: RequestContext
    ) -> SuspendOrganizationResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(session).suspend_organization(
                    user_id=user_id,
                    organization_id=org_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return SuspendOrganizationResponse(organization=org_detail_to_proto(detail))

    async def unsuspend_organization(
        self, request: UnsuspendOrganizationRequest, ctx: RequestContext
    ) -> UnsuspendOrganizationResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(
                    session
                ).unsuspend_organization(
                    user_id=user_id,
                    organization_id=org_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return UnsuspendOrganizationResponse(organization=org_detail_to_proto(detail))

    async def delete_organization(
        self, request: DeleteOrganizationRequest, ctx: RequestContext
    ) -> DeleteOrganizationResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(session).delete_organization(
                    user_id=user_id,
                    organization_id=org_id,
                    confirm_slug=request.confirm_slug,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return DeleteOrganizationResponse(organization=org_detail_to_proto(detail))

    async def restore_organization(
        self, request: RestoreOrganizationRequest, ctx: RequestContext
    ) -> RestoreOrganizationResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(
                    session
                ).restore_organization(
                    user_id=user_id,
                    organization_id=org_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RestoreOrganizationResponse(organization=org_detail_to_proto(detail))


class SystemUsersHandlers:
    async def list_users(
        self, request: ListUsersRequest, ctx: RequestContext
    ) -> ListUsersResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                page = await PlatformDirectoryOperations(session).list_users(
                    user_id=user_id,
                    page=request.page,
                    page_size=request.page_size,
                    search=request.search,
                    include_inactive=request.include_inactive,
                    only_system_admins=request.only_system_admins,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListUsersResponse(
            users=[user_summary_to_proto(r) for r in page.rows],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def get_user(
        self, request: GetUserRequest, ctx: RequestContext
    ) -> GetUserResponse:
        user_id = get_user_id_from_context(ctx)
        target_id = _parse_uuid(request.user_id, "user_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(session).get_user(
                    user_id=user_id, target_user_id=target_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetUserResponse(user=user_detail_to_proto(detail))

    async def force_logout_user(
        self, request: ForceLogoutUserRequest, ctx: RequestContext
    ) -> ForceLogoutUserResponse:
        user_id = get_user_id_from_context(ctx)
        target_id = _parse_uuid(request.user_id, "user_id")
        try:
            async with open_session() as session:
                await PlatformDirectoryOperations(session).force_logout_user(
                    user_id=user_id,
                    target_user_id=target_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ForceLogoutUserResponse()

    async def set_system_admin(
        self, request: SetSystemAdminRequest, ctx: RequestContext
    ) -> SetSystemAdminResponse:
        user_id = get_user_id_from_context(ctx)
        target_id = _parse_uuid(request.user_id, "user_id")
        try:
            async with open_session() as session:
                detail = await PlatformDirectoryOperations(session).set_system_admin(
                    user_id=user_id,
                    target_user_id=target_id,
                    is_system_admin=request.is_system_admin,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return SetSystemAdminResponse(user=user_detail_to_proto(detail))
