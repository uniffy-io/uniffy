"""RPC handlers for ``superadmin.v1.SystemConfigService``."""

from __future__ import annotations

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_config_pb2 import (
    GetMfaPolicyRequest,
    GetMfaPolicyResponse,
    GetSystemConfigRequest,
    GetSystemConfigResponse,
    SetMfaPolicyRequest,
    SetMfaPolicyResponse,
    SetPublicRegistrationRequest,
    SetPublicRegistrationResponse,
)
from uniffy_proto.superadmin.v1.system_config_pb2 import (
    MfaPolicy as MfaPolicyProto,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.auth.mfa.policy import MfaPolicyOperations
from uniffy.domains.system_config.converters import config_to_proto
from uniffy.domains.system_config.operations import SystemConfigOperations
from uniffy.domains.users.operations import UserOperations


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ValueError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.error("Unhandled error in SystemConfigService handler", exc_info=True)
    return ConnectError(Code.INTERNAL, "Internal server error")


class SystemConfigHandlers:
    """RPC handlers for ``superadmin.v1.SystemConfigService``."""

    async def get_system_config(
        self,
        request: GetSystemConfigRequest,
        ctx: RequestContext,
    ) -> GetSystemConfigResponse:
        del request
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                states = await SystemConfigOperations(session).get_state(user_id=user_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetSystemConfigResponse(config=config_to_proto(states))

    async def set_public_registration(
        self,
        request: SetPublicRegistrationRequest,
        ctx: RequestContext,
    ) -> SetPublicRegistrationResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                states = await SystemConfigOperations(session).set_public_registration(
                    user_id=user_id,
                    enabled=request.enabled,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return SetPublicRegistrationResponse(config=config_to_proto(states))

    async def get_mfa_policy(
        self,
        request: GetMfaPolicyRequest,
        ctx: RequestContext,
    ) -> GetMfaPolicyResponse:
        del request
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                await UserOperations(session).require_system_admin(user_id)
                policy = await MfaPolicyOperations(session).get()
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetMfaPolicyResponse(policy=_mfa_to_proto(policy))

    async def set_mfa_policy(
        self,
        request: SetMfaPolicyRequest,
        ctx: RequestContext,
    ) -> SetMfaPolicyResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                await UserOperations(session).require_system_admin(user_id)
                ops = MfaPolicyOperations(session)
                policy = await ops.set_required_for_system_admins(
                    required=request.required_for_system_admins,
                    actor_user_id=user_id,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return SetMfaPolicyResponse(policy=_mfa_to_proto(policy))


def _mfa_to_proto(policy) -> MfaPolicyProto:
    return MfaPolicyProto(
        required_for_system_admins=policy.required_for_system_admins,
    )
