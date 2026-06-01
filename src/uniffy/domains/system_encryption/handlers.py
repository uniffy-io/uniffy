"""RPC handlers for ``superadmin.v1.SystemEncryptionService``."""

from __future__ import annotations

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_encryption_pb2 import (
    GetDeploymentEncryptionStatusRequest,
    GetDeploymentEncryptionStatusResponse,
    RotateDeploymentDekRequest,
    RotateDeploymentDekResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.system_encryption.converters import status_to_proto
from uniffy.domains.system_encryption.operations import SystemEncryptionOperations

logger = logger.bind(component="system_encryption.handlers")


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ValueError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.exception("Unhandled error in SystemEncryptionService handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


class SystemEncryptionHandlers:
    async def get_deployment_encryption_status(
        self,
        request: GetDeploymentEncryptionStatusRequest,
        ctx: RequestContext,
    ) -> GetDeploymentEncryptionStatusResponse:
        del request
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                status = await SystemEncryptionOperations(session).get_status(
                    user_id=user_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetDeploymentEncryptionStatusResponse(status=status_to_proto(status))

    async def rotate_deployment_dek(
        self,
        request: RotateDeploymentDekRequest,
        ctx: RequestContext,
    ) -> RotateDeploymentDekResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                new_version = await SystemEncryptionOperations(session).rotate(
                    user_id=user_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RotateDeploymentDekResponse(new_active_version=new_version)
