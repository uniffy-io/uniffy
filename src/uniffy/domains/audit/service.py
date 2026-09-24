"""ConnectRPC service binding for ``audit.v1.AuditService``."""

from collections.abc import AsyncIterator

from connectrpc.request import RequestContext
from uniffy_proto.audit.v1.audit_pb import (
    ExportEventsRequest,
    ExportEventsResponse,
    ListEventsRequest,
    ListEventsResponse,
)

from uniffy.domains.audit.handlers import AuditHandlers


class AuditServiceImpl:
    """ConnectRPC service implementation - delegates to AuditHandlers."""

    def __init__(self) -> None:
        self._handlers = AuditHandlers()

    async def list_events(
        self,
        request: ListEventsRequest,
        ctx: RequestContext,
    ) -> ListEventsResponse:
        """List audit events scoped to an organization."""
        return await self._handlers.list_events(request, ctx)

    async def export_events(
        self,
        request: ExportEventsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[ExportEventsResponse]:
        """Stream a CSV / NDJSON export of the current filter view."""
        async for chunk in self._handlers.export_events(request, ctx):
            yield chunk
