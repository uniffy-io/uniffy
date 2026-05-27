"""RPC handlers for ``superadmin.v1.SystemMailService``."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_mail_pb2 import (
    ClearSystemMailConfigRequest,
    ClearSystemMailConfigResponse,
    ForceClearOrgConfigRequest,
    ForceClearOrgConfigResponse,
    GetSystemMailConfigRequest,
    GetSystemMailConfigResponse,
    ListGlobalDeliveriesRequest,
    ListGlobalDeliveriesResponse,
    ListGlobalSuppressionsRequest,
    ListGlobalSuppressionsResponse,
    ListOrgMailConfigsRequest,
    ListOrgMailConfigsResponse,
    RemoveGlobalSuppressionRequest,
    RemoveGlobalSuppressionResponse,
    UpdateSystemMailConfigRequest,
    UpdateSystemMailConfigResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.mail.system_converters import (
    delivery_to_proto,
    org_row_to_proto,
    suppression_to_proto,
    system_summary_to_proto,
)
from uniffy.domains.mail.system_operations import SystemMailOperations


def _parse_uuid(value: str, field: str) -> UUID:
    if not value:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is required")
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is not a valid UUID") from exc


def _parse_optional_uuid(value: str, field: str) -> UUID | None:
    if not value:
        return None
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
    logger.error("Unhandled error in SystemMailService handler", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class SystemMailHandlers:
    """RPC handlers for ``superadmin.v1.SystemMailService``."""

    async def get_system_mail_config(
        self,
        request: GetSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> GetSystemMailConfigResponse:
        del request
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                summary = await SystemMailOperations(session).get_system_config(
                    user_id=user_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetSystemMailConfigResponse(config=system_summary_to_proto(summary))

    async def update_system_mail_config(
        self,
        request: UpdateSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> UpdateSystemMailConfigResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                summary = await SystemMailOperations(session).update_system_config(
                    user_id=user_id,
                    from_address=request.from_address,
                    from_name=request.from_name,
                    reply_to=request.reply_to,
                    smtp_host=request.smtp_host,
                    smtp_port=request.smtp_port,
                    smtp_username=request.smtp_username,
                    smtp_password=request.smtp_password,
                    smtp_use_tls=request.smtp_use_tls,
                    rate_limit_per_min=request.rate_limit_per_min,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return UpdateSystemMailConfigResponse(config=system_summary_to_proto(summary))

    async def clear_system_mail_config(
        self,
        request: ClearSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> ClearSystemMailConfigResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                deleted = await SystemMailOperations(session).clear_system_config(
                    user_id=user_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ClearSystemMailConfigResponse(deleted_keys=deleted)

    async def list_org_mail_configs(
        self,
        request: ListOrgMailConfigsRequest,
        ctx: RequestContext,
    ) -> ListOrgMailConfigsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                page = await SystemMailOperations(session).list_org_configs(
                    user_id=user_id,
                    page=request.page,
                    page_size=request.page_size,
                    search=request.search,
                    only_with_org_config=request.only_with_org_config,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListOrgMailConfigsResponse(
            configs=[org_row_to_proto(row) for row in page.rows],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def force_clear_org_config(
        self,
        request: ForceClearOrgConfigRequest,
        ctx: RequestContext,
    ) -> ForceClearOrgConfigResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                deleted = await SystemMailOperations(session).force_clear_org_config(
                    user_id=user_id,
                    organization_id=organization_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ForceClearOrgConfigResponse(deleted_keys=deleted)

    async def list_global_suppressions(
        self,
        request: ListGlobalSuppressionsRequest,
        ctx: RequestContext,
    ) -> ListGlobalSuppressionsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                page = await SystemMailOperations(session).list_suppressions(
                    user_id=user_id,
                    page=request.page,
                    page_size=request.page_size,
                    search=request.search,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListGlobalSuppressionsResponse(
            entries=[suppression_to_proto(e) for e in page.entries],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def remove_global_suppression(
        self,
        request: RemoveGlobalSuppressionRequest,
        ctx: RequestContext,
    ) -> RemoveGlobalSuppressionResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                removed = await SystemMailOperations(session).remove_suppression(
                    user_id=user_id,
                    email=request.email,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RemoveGlobalSuppressionResponse(removed=removed)

    async def list_global_deliveries(
        self,
        request: ListGlobalDeliveriesRequest,
        ctx: RequestContext,
    ) -> ListGlobalDeliveriesResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_optional_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                page = await SystemMailOperations(session).list_deliveries(
                    user_id=user_id,
                    page=request.page,
                    page_size=request.page_size,
                    organization_id=org_id,
                    outcome=request.outcome,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListGlobalDeliveriesResponse(
            entries=[delivery_to_proto(e) for e in page.entries],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )
