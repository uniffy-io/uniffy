"""ConnectRPC service binding for ``superadmin.v1.PlatformAuditService``."""

from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.platform_audit_pb2 import (
    ListPlatformActionsRequest,
    ListPlatformActionsResponse,
    ListPlatformAuditRequest,
    ListPlatformAuditResponse,
)

from uniffy.domains.platform.audit.handlers import PlatformAuditHandlers


class PlatformAuditServiceImpl:
    """ConnectRPC service implementation for the platform audit feed."""

    def __init__(self) -> None:
        self._handlers = PlatformAuditHandlers()

    async def list_platform_audit(
        self, request: ListPlatformAuditRequest, ctx: RequestContext
    ) -> ListPlatformAuditResponse:
        return await self._handlers.list_platform_audit(request, ctx)

    async def list_platform_actions(
        self, request: ListPlatformActionsRequest, ctx: RequestContext
    ) -> ListPlatformActionsResponse:
        return await self._handlers.list_platform_actions(request, ctx)
