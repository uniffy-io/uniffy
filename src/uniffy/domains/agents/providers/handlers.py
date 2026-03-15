"""Agent providers RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.converters.common_proto import visibility_from_proto
from uniffy.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import get_async_session
from uniffy.domains.agents.providers.converters import (
    credential_type_from_proto,
    model_info_to_proto,
    provider_key_to_proto,
)
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.gen.agents.v1.providers_pb2 import (
    AddProviderKeyRequest,
    ListAvailableModelsRequest,
    ListAvailableModelsResponse,
    ListModelsForKeyRequest,
    ListProviderKeysRequest,
    ListProviderKeysResponse,
    ProviderKeyResponse,
    RemoveProviderKeyRequest,
    RemoveProviderKeyResponse,
    ToggleProviderKeyRequest,
    ValidateProviderKeyRequest,
    ValidateProviderKeyResponse,
)


class ProvidersHandlers:
    """RPC handlers for providers service."""

    async def add_provider_key(
        self,
        request: AddProviderKeyRequest,
        ctx: RequestContext,
    ) -> ProviderKeyResponse:
        """Handle add_provider_key RPC call.

        Parameters
        ----------
        request : AddProviderKeyRequest
            The request with credential details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProviderKeyResponse
            The created provider key info.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        credential_type = credential_type_from_proto(request.credential_type)
        visibility = (
            visibility_from_proto(request.visibility) if request.HasField("visibility") else None
        )

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                kwargs: dict = {
                    "user_id": user_id,
                    "organization_id": org_id,
                    "provider": request.provider,
                    "credential_type": credential_type,
                    "label": request.label,
                    "credential": request.credential,
                }
                if visibility is not None:
                    kwargs["visibility"] = visibility
                key = await ops.add_key(**kwargs)
                return ProviderKeyResponse(key=provider_key_to_proto(key))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConflictError as e:
            raise ConnectError(Code.ALREADY_EXISTS, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding provider key: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_provider_keys(
        self,
        request: ListProviderKeysRequest,
        ctx: RequestContext,
    ) -> ListProviderKeysResponse:
        """Handle list_provider_keys RPC call.

        Parameters
        ----------
        request : ListProviderKeysRequest
            The request with organization ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListProviderKeysResponse
            List of provider key infos.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        provider = request.provider if request.HasField("provider") else None

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                keys = await ops.list_keys(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=provider,
                )
                return ListProviderKeysResponse(
                    keys=[provider_key_to_proto(k) for k in keys],
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing provider keys: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_provider_key(
        self,
        request: RemoveProviderKeyRequest,
        ctx: RequestContext,
    ) -> RemoveProviderKeyResponse:
        """Handle remove_provider_key RPC call.

        Parameters
        ----------
        request : RemoveProviderKeyRequest
            The request with key ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        RemoveProviderKeyResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            key_id = UUID(request.key_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                await ops.remove_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                )
                return RemoveProviderKeyResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Provider key not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing provider key: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def validate_provider_key(
        self,
        request: ValidateProviderKeyRequest,
        ctx: RequestContext,
    ) -> ValidateProviderKeyResponse:
        """Handle validate_provider_key RPC call.

        Parameters
        ----------
        request : ValidateProviderKeyRequest
            The request with key ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ValidateProviderKeyResponse
            Validation result.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            key_id = UUID(request.key_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
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

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Provider key not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error validating provider key: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_available_models(
        self,
        request: ListAvailableModelsRequest,
        ctx: RequestContext,
    ) -> ListAvailableModelsResponse:
        """Handle list_available_models RPC call.

        Parameters
        ----------
        request : ListAvailableModelsRequest
            The request with organization ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListAvailableModelsResponse
            Available models.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        provider = request.provider if request.HasField("provider") else None

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                models = await ops.list_available_models(
                    user_id=user_id,
                    organization_id=org_id,
                    provider=provider,
                    force_refresh=request.force_refresh,
                )
                return ListAvailableModelsResponse(
                    models=[model_info_to_proto(m) for m in models],
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing available models: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def toggle_provider_key(
        self,
        request: ToggleProviderKeyRequest,
        ctx: RequestContext,
    ) -> ProviderKeyResponse:
        """Handle toggle_provider_key RPC call.

        Parameters
        ----------
        request : ToggleProviderKeyRequest
            The request with organization ID, key ID, and enabled flag.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ProviderKeyResponse
            Updated provider key info.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            key_id = UUID(request.key_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                key = await ops.toggle_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                    enabled=request.enabled,
                )
                return ProviderKeyResponse(key=provider_key_to_proto(key))

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error toggling provider key: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_models_for_key(
        self,
        request: ListModelsForKeyRequest,
        ctx: RequestContext,
    ) -> ListAvailableModelsResponse:
        """Handle list_models_for_key RPC call.

        Lists models available through a specific provider key.

        Parameters
        ----------
        request : ListModelsForKeyRequest
            The request with key ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListAvailableModelsResponse
            Available models for this key.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            key_id = UUID(request.key_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ProviderOperations(session)
                models = await ops.list_models_for_key(
                    user_id=user_id,
                    organization_id=org_id,
                    key_id=key_id,
                    force_refresh=request.force_refresh,
                )
                return ListAvailableModelsResponse(
                    models=[model_info_to_proto(m) for m in models],
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Provider key not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing models for key: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
