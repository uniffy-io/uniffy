"""Providers RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.providers_pb2 import (
    AddProviderKeyRequest,
    AddProviderKeyResponse,
    ListAvailableModelsRequest,
    ListAvailableModelsResponse,
    ListModelsForKeyRequest,
    ListModelsForKeyResponse,
    ListProviderKeysRequest,
    ListProviderKeysResponse,
    RemoveProviderKeyRequest,
    RemoveProviderKeyResponse,
    ToggleProviderKeyRequest,
    ToggleProviderKeyResponse,
    ValidateProviderKeyRequest,
    ValidateProviderKeyResponse,
)

from uniffy.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.access import is_org_admin
from uniffy.domains.agents.providers.converters import (
    model_info_to_proto,
    provider_key_to_proto,
)
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.auth.context import get_user_id_from_context

logger = logger.bind(component="agents.providers.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
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


class ProvidersHandlers:
    """RPC handlers for ``agents.v1.ProvidersService``."""

    async def add_provider_key(
        self,
        request: AddProviderKeyRequest,
        ctx: RequestContext,
    ) -> AddProviderKeyResponse:
        """Add a new provider key."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                key = await ops.add_key(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=request.provider,
                    label=request.label,
                    credential=request.credential,
                )
                # add_key is org-admin gated, so the caller may see diagnostics.
                return AddProviderKeyResponse(
                    key=provider_key_to_proto(key, include_diagnostics=True),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("add_provider_key", exc) from exc

    async def list_provider_keys(
        self,
        request: ListProviderKeysRequest,
        ctx: RequestContext,
    ) -> ListProviderKeysResponse:
        """List provider keys for an organization."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        provider = request.provider if request.HasField("provider") else None

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                keys = await ops.list_keys(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=provider,
                )
                diagnostics = await is_org_admin(session, user_id, org_id)
                return ListProviderKeysResponse(
                    keys=[provider_key_to_proto(k, include_diagnostics=diagnostics) for k in keys],
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_provider_keys", exc) from exc

    async def remove_provider_key(
        self,
        request: RemoveProviderKeyRequest,
        ctx: RequestContext,
    ) -> RemoveProviderKeyResponse:
        """Remove a provider key."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        key_id = _parse_uuid(request.key_id, "key_id")

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                await ops.remove_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                )
                return RemoveProviderKeyResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("remove_provider_key", exc) from exc

    async def validate_provider_key(
        self,
        request: ValidateProviderKeyRequest,
        ctx: RequestContext,
    ) -> ValidateProviderKeyResponse:
        """Validate a provider key against the provider API."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        key_id = _parse_uuid(request.key_id, "key_id")

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                is_valid, error = await ops.validate_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                )
                resp = ValidateProviderKeyResponse(is_valid=is_valid)
                if error:
                    resp.error = error
                return resp
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("validate_provider_key", exc) from exc

    async def list_available_models(
        self,
        request: ListAvailableModelsRequest,
        ctx: RequestContext,
    ) -> ListAvailableModelsResponse:
        """List models exposed by all provider keys in the org."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        provider = request.provider if request.HasField("provider") else None

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                models = await ops.list_available_models(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=provider,
                )
                return ListAvailableModelsResponse(
                    models=[model_info_to_proto(m) for m in models],
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_available_models", exc) from exc

    async def toggle_provider_key(
        self,
        request: ToggleProviderKeyRequest,
        ctx: RequestContext,
    ) -> ToggleProviderKeyResponse:
        """Enable or disable a provider key."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        key_id = _parse_uuid(request.key_id, "key_id")

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                key = await ops.toggle_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                    enabled=request.enabled,
                )
                # toggle_key is org-admin gated, so the caller may see diagnostics.
                return ToggleProviderKeyResponse(
                    key=provider_key_to_proto(key, include_diagnostics=True),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("toggle_provider_key", exc) from exc

    async def list_models_for_key(
        self,
        request: ListModelsForKeyRequest,
        ctx: RequestContext,
    ) -> ListModelsForKeyResponse:
        """List models exposed by a specific provider key."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        key_id = _parse_uuid(request.key_id, "key_id")

        try:
            async with open_session() as session:
                ops = ProviderOperations(session)
                models = await ops.list_models_for_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                )
                return ListModelsForKeyResponse(
                    models=[model_info_to_proto(m) for m in models],
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_models_for_key", exc) from exc
