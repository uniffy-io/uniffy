"""RPC handlers for the per-org agent runtime settings surface."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.runtime_pb2 import (
    GetRuntimeSettingsRequest,
    RuntimeSettings,
    RuntimeSettingsResponse,
    UpdateRuntimeSettingsRequest,
)

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.runtime.settings import (
    ResolvedRuntimeSettings,
    RuntimeSettingsOperations,
)
from uniffy.domains.auth.context import get_user_id_from_context

logger = logger.bind(component="agents.runtime.settings_handlers")


def _to_proto(resolved: ResolvedRuntimeSettings) -> RuntimeSettings:
    return RuntimeSettings(
        send_deadline_seconds=resolved.send_deadline_seconds,
        failover_enabled=resolved.failover_enabled,
        resume_enabled=resolved.resume_enabled,
        circuit_breaker_failure_threshold=resolved.circuit_breaker_failure_threshold,
        circuit_breaker_recovery_seconds=resolved.circuit_breaker_recovery_seconds,
        personal_memory_bridge_enabled=resolved.personal_memory_bridge_enabled,
        default_provider_key_id=(
            str(resolved.default_provider_key_id)
            if resolved.default_provider_key_id
            else ""
        ),
        default_chat_model=resolved.default_chat_model or "",
        image_max_resolution=resolved.image_max_resolution or "",
        image_max_quality=resolved.image_max_quality or "",
    )


class RuntimeSettingsHandlers:
    """Org-admin read/write of the runtime settings blob."""

    async def get_runtime_settings(
        self,
        request: GetRuntimeSettingsRequest,
        ctx: RequestContext,
    ) -> RuntimeSettingsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = RuntimeSettingsOperations(session)
                resolved, configured = await ops.get(
                    user_id=user_id, organization_id=org_id
                )
                return RuntimeSettingsResponse(
                    settings=_to_proto(resolved), configured=configured
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error in get_runtime_settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_runtime_settings(
        self,
        request: UpdateRuntimeSettingsRequest,
        ctx: RequestContext,
    ) -> RuntimeSettingsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        s = request.settings
        try:
            async with open_session() as session:
                ops = RuntimeSettingsOperations(session)
                resolved, configured = await ops.update(
                    user_id=user_id,
                    organization_id=org_id,
                    send_deadline_seconds=s.send_deadline_seconds,
                    failover_enabled=s.failover_enabled,
                    resume_enabled=s.resume_enabled,
                    circuit_breaker_failure_threshold=s.circuit_breaker_failure_threshold,
                    circuit_breaker_recovery_seconds=s.circuit_breaker_recovery_seconds,
                    personal_memory_bridge_enabled=s.personal_memory_bridge_enabled,
                    default_provider_key_id=s.default_provider_key_id,
                    default_chat_model=s.default_chat_model,
                    image_max_resolution=s.image_max_resolution,
                    image_max_quality=s.image_max_quality,
                )
                return RuntimeSettingsResponse(
                    settings=_to_proto(resolved), configured=configured
                )
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error in update_runtime_settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")


class RuntimeSettingsServiceImpl(RuntimeSettingsHandlers):
    """ConnectRPC service implementation for RuntimeSettingsService."""
