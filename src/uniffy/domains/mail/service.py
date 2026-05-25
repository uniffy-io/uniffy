"""ConnectRPC service binding for ``mail.v1.OrgMailService``."""

from connectrpc.request import RequestContext
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

from uniffy.domains.mail.handlers import OrgMailHandlers


class OrgMailServiceImpl:
    """ConnectRPC service implementation - delegates to OrgMailHandlers."""

    def __init__(self) -> None:
        self._handlers = OrgMailHandlers()

    async def get_mail_config(
        self,
        request: GetMailConfigRequest,
        ctx: RequestContext,
    ) -> GetMailConfigResponse:
        """Read the org's effective mail config."""
        return await self._handlers.get_mail_config(request, ctx)

    async def update_mail_config(
        self,
        request: UpdateMailConfigRequest,
        ctx: RequestContext,
    ) -> UpdateMailConfigResponse:
        """Upsert the org's mail config."""
        return await self._handlers.update_mail_config(request, ctx)

    async def clear_mail_config(
        self,
        request: ClearMailConfigRequest,
        ctx: RequestContext,
    ) -> ClearMailConfigResponse:
        """Drop every mail.* row for the org."""
        return await self._handlers.clear_mail_config(request, ctx)

    async def send_test_mail(
        self,
        request: SendTestMailRequest,
        ctx: RequestContext,
    ) -> SendTestMailResponse:
        """One-shot test send via the org's resolved config."""
        return await self._handlers.send_test_mail(request, ctx)
