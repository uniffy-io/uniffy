from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.system_config_pb2 import (
    GetMfaPolicyRequest,
    GetMfaPolicyResponse,
    GetSystemConfigRequest,
    GetSystemConfigResponse,
    SetMfaPolicyRequest,
    SetMfaPolicyResponse,
    SetPublicRegistrationRequest,
    SetPublicRegistrationResponse,
)

from uniffy.domains.system_config.handlers import SystemConfigHandlers


class SystemConfigServiceImpl:
    def __init__(self) -> None:
        self._handlers = SystemConfigHandlers()

    async def get_system_config(
        self,
        request: GetSystemConfigRequest,
        ctx: RequestContext,
    ) -> GetSystemConfigResponse:
        return await self._handlers.get_system_config(request, ctx)

    async def set_public_registration(
        self,
        request: SetPublicRegistrationRequest,
        ctx: RequestContext,
    ) -> SetPublicRegistrationResponse:
        return await self._handlers.set_public_registration(request, ctx)

    async def get_mfa_policy(
        self,
        request: GetMfaPolicyRequest,
        ctx: RequestContext,
    ) -> GetMfaPolicyResponse:
        return await self._handlers.get_mfa_policy(request, ctx)

    async def set_mfa_policy(
        self,
        request: SetMfaPolicyRequest,
        ctx: RequestContext,
    ) -> SetMfaPolicyResponse:
        return await self._handlers.set_mfa_policy(request, ctx)
