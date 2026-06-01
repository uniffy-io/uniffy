"""RPC handlers for ``mail.v1.OrgMailService``."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.mail.v1.mail_pb2 import (
    ClearMailConfigRequest,
    ClearMailConfigResponse,
    GetMailConfigRequest,
    GetMailConfigResponse,
    SendTestMailRequest,
    SendTestMailResponse,
    UpdateMailConfigRequest,
    UpdateMailConfigResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.mail.converters import summary_to_proto
from uniffy.domains.mail.operations import OrgMailOperations

logger = logger.bind(component="mail.handlers")


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
    logger.exception("Unhandled error in OrgMailService handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


class OrgMailHandlers:
    """RPC handlers for ``mail.v1.OrgMailService``."""

    async def get_mail_config(
        self,
        request: GetMailConfigRequest,
        ctx: RequestContext,
    ) -> GetMailConfigResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                summary = await OrgMailOperations(session).get_config(
                    user_id=user_id,
                    organization_id=organization_id,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

        return GetMailConfigResponse(config=summary_to_proto(summary))

    async def update_mail_config(
        self,
        request: UpdateMailConfigRequest,
        ctx: RequestContext,
    ) -> UpdateMailConfigResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                summary = await OrgMailOperations(session).update_config(
                    user_id=user_id,
                    organization_id=organization_id,
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

        return UpdateMailConfigResponse(config=summary_to_proto(summary))

    async def clear_mail_config(
        self,
        request: ClearMailConfigRequest,
        ctx: RequestContext,
    ) -> ClearMailConfigResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                deleted = await OrgMailOperations(session).clear_config(
                    user_id=user_id,
                    organization_id=organization_id,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

        return ClearMailConfigResponse(deleted_keys=deleted)

    async def send_test_mail(
        self,
        request: SendTestMailRequest,
        ctx: RequestContext,
    ) -> SendTestMailResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                result = await OrgMailOperations(session).send_test(
                    user_id=user_id,
                    organization_id=organization_id,
                    recipient_email=request.recipient_email,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

        response = SendTestMailResponse(
            success=result.success,
            status="ok" if result.success else "failed",
        )
        if result.provider_message_id is not None:
            response.provider_message_id = result.provider_message_id
        if result.error is not None:
            response.error = result.error
        return response
