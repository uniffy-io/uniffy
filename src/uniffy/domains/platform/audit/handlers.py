"""RPC handlers for ``superadmin.v1.PlatformAuditService``."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.platform_audit_pb import (
    ListPlatformActionsRequest,
    ListPlatformActionsResponse,
    ListPlatformAuditRequest,
    ListPlatformAuditResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.platform.audit.converters import (
    action_entry_to_proto,
    event_to_proto,
)
from uniffy.domains.platform.audit.operations import PlatformAuditOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="platform.audit.handlers")


def _parse_optional_uuid(value: str, field: str) -> UUID | None:
    if not value:
        return None
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
    logger.exception("Unhandled error in PlatformAuditService handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


class PlatformAuditHandlers:
    async def list_platform_audit(
        self, request: ListPlatformAuditRequest, ctx: RequestContext
    ) -> ListPlatformAuditResponse:
        actor_id = current_user_id()
        org_id = _parse_optional_uuid(request.organization_id, "organization_id")
        actor_filter = _parse_optional_uuid(request.actor_user_id, "actor_user_id")
        from_ts = timestamp_to_datetime(request.from_ts) if request.has_field("from_ts") else None
        to_ts = timestamp_to_datetime(request.to_ts) if request.has_field("to_ts") else None
        try:
            async with open_session() as session:
                page = await PlatformAuditOperations(session).list_events(
                    actor_user_id=actor_id,
                    page=request.page,
                    page_size=request.page_size,
                    organization_id=org_id,
                    target_actor_user_id=actor_filter,
                    actions=list(request.actions) if request.actions else None,
                    from_ts=from_ts,
                    to_ts=to_ts,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListPlatformAuditResponse(
            events=[event_to_proto(v) for v in page.events],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def list_platform_actions(
        self, request: ListPlatformActionsRequest, ctx: RequestContext
    ) -> ListPlatformActionsResponse:
        del request
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                entries = await PlatformAuditOperations(session).list_actions(actor_user_id=actor_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListPlatformActionsResponse(actions=[action_entry_to_proto(e) for e in entries])
