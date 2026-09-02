"""ConnectRPC service binding for ``superadmin.v1.SystemMailService``."""

from connectrpc.request import RequestContext
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

from uniffy.domains.mail.system.handlers import SystemMailHandlers


class SystemMailServiceImpl:
    """ConnectRPC SystemMailService."""

    def __init__(self) -> None:
        self._handlers = SystemMailHandlers()

    async def get_system_mail_config(
        self,
        request: GetSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> GetSystemMailConfigResponse:
        return await self._handlers.get_system_mail_config(request, ctx)

    async def update_system_mail_config(
        self,
        request: UpdateSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> UpdateSystemMailConfigResponse:
        return await self._handlers.update_system_mail_config(request, ctx)

    async def clear_system_mail_config(
        self,
        request: ClearSystemMailConfigRequest,
        ctx: RequestContext,
    ) -> ClearSystemMailConfigResponse:
        return await self._handlers.clear_system_mail_config(request, ctx)

    async def list_org_mail_configs(
        self,
        request: ListOrgMailConfigsRequest,
        ctx: RequestContext,
    ) -> ListOrgMailConfigsResponse:
        return await self._handlers.list_org_mail_configs(request, ctx)

    async def force_clear_org_config(
        self,
        request: ForceClearOrgConfigRequest,
        ctx: RequestContext,
    ) -> ForceClearOrgConfigResponse:
        return await self._handlers.force_clear_org_config(request, ctx)

    async def list_global_suppressions(
        self,
        request: ListGlobalSuppressionsRequest,
        ctx: RequestContext,
    ) -> ListGlobalSuppressionsResponse:
        return await self._handlers.list_global_suppressions(request, ctx)

    async def remove_global_suppression(
        self,
        request: RemoveGlobalSuppressionRequest,
        ctx: RequestContext,
    ) -> RemoveGlobalSuppressionResponse:
        return await self._handlers.remove_global_suppression(request, ctx)

    async def list_global_deliveries(
        self,
        request: ListGlobalDeliveriesRequest,
        ctx: RequestContext,
    ) -> ListGlobalDeliveriesResponse:
        return await self._handlers.list_global_deliveries(request, ctx)
