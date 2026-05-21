"""RPC handlers for ``audit.v1.AuditService``.

Thin wrappers that parse the request, delegate to
:class:`AuditOperations`, and map domain results / errors back to
proto. All writes go through :func:`uniffy.core.audit.write_audit_event`
at the mutation call site - this service is read-only.
"""

from collections.abc import AsyncIterator
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.audit.v1.audit_pb2 import (
    EXPORT_FORMAT_CSV,
    EXPORT_FORMAT_JSON,
    SORT_ORDER_TIME_ASC,
    ExportEventsRequest,
    ExportEventsResponse,
    ListEventsRequest,
    ListEventsResponse,
)

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.audit.converters import audit_event_to_proto
from uniffy.domains.audit.export import ExportFilter, ExportOperations
from uniffy.domains.audit.operations import (
    AuditOperations,
    ListEventsFilter,
    SortOrder,
)
from uniffy.domains.auth.context import get_user_id_from_context


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise INVALID_ARGUMENT."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(exc: Exception) -> ConnectError:
    """Convert a domain error into a ConnectError with the right code."""
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.error("Unhandled error in AuditService handler", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class AuditHandlers:
    """RPC handlers for ``audit.v1.AuditService``."""

    async def list_events(
        self,
        request: ListEventsRequest,
        ctx: RequestContext,
    ) -> ListEventsResponse:
        """Page through audit events scoped to a single organization."""
        user_id = get_user_id_from_context(ctx)
        organization_id = _parse_uuid(request.organization_id, "organization_id")

        actor_user_id = (
            _parse_uuid(request.actor_user_id, "actor_user_id")
            if request.HasField("actor_user_id")
            else None
        )
        resource_id = (
            _parse_uuid(request.resource_id, "resource_id")
            if request.HasField("resource_id")
            else None
        )

        filters = ListEventsFilter(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            actions=tuple(request.actions),
            resource_type=(
                request.resource_type if request.HasField("resource_type") else None
            ),
            resource_id=resource_id,
            from_time=(
                request.from_time.ToDatetime()
                if request.HasField("from_time")
                else None
            ),
            to_time=(
                request.to_time.ToDatetime() if request.HasField("to_time") else None
            ),
            page_size=request.page_size,
            page_token=request.page_token if request.HasField("page_token") else None,
            order=(
                SortOrder.TIME_ASC
                if request.order == SORT_ORDER_TIME_ASC
                else SortOrder.TIME_DESC
            ),
        )

        try:
            async with open_session() as session:
                ops = AuditOperations(session)
                page = await ops.list_events(user_id, filters)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc

        response = ListEventsResponse()
        response.events.extend(audit_event_to_proto(event) for event in page.events)
        if page.next_page_token is not None:
            response.next_page_token = page.next_page_token
        return response

    async def export_events(
        self,
        request: ExportEventsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[ExportEventsResponse]:
        """Stream a CSV / NDJSON dump of every row matching the filter."""
        user_id = get_user_id_from_context(ctx)
        filter_msg = request.filter

        if request.format == EXPORT_FORMAT_CSV:
            export_format = "csv"
        elif request.format == EXPORT_FORMAT_JSON:
            export_format = "ndjson"
        else:
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "Export format must be CSV or JSON",
            )

        organization_id = _parse_uuid(filter_msg.organization_id, "organization_id")
        actor_user_id = (
            _parse_uuid(filter_msg.actor_user_id, "actor_user_id")
            if filter_msg.HasField("actor_user_id")
            else None
        )
        resource_id = (
            _parse_uuid(filter_msg.resource_id, "resource_id")
            if filter_msg.HasField("resource_id")
            else None
        )

        filters = ListEventsFilter(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            actions=tuple(filter_msg.actions),
            resource_type=(
                filter_msg.resource_type
                if filter_msg.HasField("resource_type")
                else None
            ),
            resource_id=resource_id,
            from_time=(
                filter_msg.from_time.ToDatetime()
                if filter_msg.HasField("from_time")
                else None
            ),
            to_time=(
                filter_msg.to_time.ToDatetime()
                if filter_msg.HasField("to_time")
                else None
            ),
        )

        try:
            async with open_session() as session:
                ops = ExportOperations(session)
                async for chunk in ops.stream_export(
                    user_id, ExportFilter(filter=filters, format=export_format)
                ):
                    yield ExportEventsResponse(payload=chunk)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
