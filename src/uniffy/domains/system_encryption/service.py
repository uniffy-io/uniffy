"""ConnectRPC service binding for ``superadmin.v1.SystemEncryptionService``."""

from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.system_encryption_pb2 import (
    GetDeploymentEncryptionStatusRequest,
    GetDeploymentEncryptionStatusResponse,
    RotateDeploymentDekRequest,
    RotateDeploymentDekResponse,
)

from uniffy.domains.system_encryption.handlers import SystemEncryptionHandlers


class SystemEncryptionServiceImpl:
    def __init__(self) -> None:
        self._handlers = SystemEncryptionHandlers()

    async def get_deployment_encryption_status(
        self,
        request: GetDeploymentEncryptionStatusRequest,
        ctx: RequestContext,
    ) -> GetDeploymentEncryptionStatusResponse:
        return await self._handlers.get_deployment_encryption_status(request, ctx)

    async def rotate_deployment_dek(
        self,
        request: RotateDeploymentDekRequest,
        ctx: RequestContext,
    ) -> RotateDeploymentDekResponse:
        return await self._handlers.rotate_deployment_dek(request, ctx)
