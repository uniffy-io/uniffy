"""Integrations RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.integrations.v1.integrations_pb2 import (
    AddConnectionRequest,
    AddConnectionResponse,
    ListConnectionsRequest,
    ListConnectionsResponse,
    ListIntegrationProvidersRequest,
    ListIntegrationProvidersResponse,
    RemoveConnectionRequest,
    RemoveConnectionResponse,
    ToggleConnectionRequest,
    ToggleConnectionResponse,
    UpdateConnectionRequest,
    UpdateConnectionResponse,
    ValidateConnectionRequest,
    ValidateConnectionResponse,
)

from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.db import open_session
from uniffy.domains.agents.access import is_org_admin
from uniffy.domains.auth.context import (
    get_user_id_from_context,
    resolve_organization_id,
)
from uniffy.domains.integrations.converters import (
    connection_to_proto,
    provider_info_to_proto,
)
from uniffy.domains.integrations.operations import ConnectionOperations
from uniffy.domains.integrations.registry import get_integration_registry
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="integrations.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}") from exc


def _domain_error_to_connect(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ConflictError):
        return ConnectError(Code.ALREADY_EXISTS, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class IntegrationsHandlers:
    """RPC handlers for ``integrations.v1.IntegrationsService``."""

    async def list_integration_providers(
        self,
        request: ListIntegrationProvidersRequest,
        ctx: RequestContext,
    ) -> ListIntegrationProvidersResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
            return ListIntegrationProvidersResponse(
                providers=[
                    provider_info_to_proto(p.descriptor)
                    for p in get_integration_registry().list_providers()
                ],
            )
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("list_integration_providers", exc) from exc

    async def list_connections(
        self,
        request: ListConnectionsRequest,
        ctx: RequestContext,
    ) -> ListConnectionsResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        provider = request.provider if request.HasField("provider") else None

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                connections = await ops.list_connections(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=provider,
                )
                # One cached role read per RPC, not per row.
                diagnostics = await is_org_admin(session, user_id, org_id)
                return ListConnectionsResponse(
                    connections=[
                        connection_to_proto(c, include_diagnostics=diagnostics) for c in connections
                    ],
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("list_connections", exc) from exc

    async def add_connection(
        self,
        request: AddConnectionRequest,
        ctx: RequestContext,
    ) -> AddConnectionResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                row = await ops.add_connection(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=request.provider,
                    name=request.name,
                    credential=request.credential,
                    base_url=request.base_url if request.HasField("base_url") else None,
                    allow_writes=request.allow_writes,
                )
                # add_connection is org-admin gated, so the caller may see diagnostics.
                return AddConnectionResponse(
                    connection=connection_to_proto(row, include_diagnostics=True),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("add_connection", exc) from exc

    async def update_connection(
        self,
        request: UpdateConnectionRequest,
        ctx: RequestContext,
    ) -> UpdateConnectionResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)
        connection_id = _parse_uuid(request.connection_id, "connection_id")

        kwargs: dict = {}
        if request.HasField("name"):
            kwargs["name"] = request.name
        if request.HasField("base_url"):
            kwargs["base_url"] = request.base_url
        if request.HasField("allow_writes"):
            kwargs["allow_writes"] = request.allow_writes
        if request.HasField("credential"):
            kwargs["credential"] = request.credential

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                row = await ops.update_connection(
                    user_id=user_id,
                    organization_id=org_id,
                    connection_id=connection_id,
                    **kwargs,
                )
                return UpdateConnectionResponse(
                    connection=connection_to_proto(row, include_diagnostics=True),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("update_connection", exc) from exc

    async def remove_connection(
        self,
        request: RemoveConnectionRequest,
        ctx: RequestContext,
    ) -> RemoveConnectionResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)
        connection_id = _parse_uuid(request.connection_id, "connection_id")

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                await ops.remove_connection(
                    user_id=user_id,
                    organization_id=org_id,
                    connection_id=connection_id,
                )
                return RemoveConnectionResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("remove_connection", exc) from exc

    async def validate_connection(
        self,
        request: ValidateConnectionRequest,
        ctx: RequestContext,
    ) -> ValidateConnectionResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)
        connection_id = _parse_uuid(request.connection_id, "connection_id")

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                row = await ops.validate_connection(
                    user_id=user_id,
                    organization_id=org_id,
                    connection_id=connection_id,
                )
                # Admin-gated RPC, so raw probe error text is acceptable here.
                resp = ValidateConnectionResponse(is_valid=row.is_valid)
                if row.last_error:
                    resp.error = row.last_error
                if row.account_login:
                    resp.account_login = row.account_login
                return resp
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("validate_connection", exc) from exc

    async def toggle_connection(
        self,
        request: ToggleConnectionRequest,
        ctx: RequestContext,
    ) -> ToggleConnectionResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = resolve_organization_id(ctx, request.organization_id)
        connection_id = _parse_uuid(request.connection_id, "connection_id")

        try:
            async with open_session() as session:
                ops = ConnectionOperations(session)
                row = await ops.toggle_connection(
                    user_id=user_id,
                    organization_id=org_id,
                    connection_id=connection_id,
                    enabled=request.enabled,
                )
                return ToggleConnectionResponse(
                    connection=connection_to_proto(row, include_diagnostics=True),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _domain_error_to_connect("toggle_connection", exc) from exc
