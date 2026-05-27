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
    """ConnectRPC OrgMailService."""

    def __init__(self) -> None:
        self._handlers = OrgMailHandlers()

    async def get_mail_config(
        self,
        request: GetMailConfigRequest,
        ctx: RequestContext,
    ) -> GetMailConfigResponse:
        return await self._handlers.get_mail_config(request, ctx)

    async def update_mail_config(
        self,
        request: UpdateMailConfigRequest,
        ctx: RequestContext,
    ) -> UpdateMailConfigResponse:
        return await self._handlers.update_mail_config(request, ctx)

    async def clear_mail_config(
        self,
        request: ClearMailConfigRequest,
        ctx: RequestContext,
    ) -> ClearMailConfigResponse:
        return await self._handlers.clear_mail_config(request, ctx)

    async def send_test_mail(
        self,
        request: SendTestMailRequest,
        ctx: RequestContext,
    ) -> SendTestMailResponse:
        return await self._handlers.send_test_mail(request, ctx)
