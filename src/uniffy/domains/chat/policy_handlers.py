"""Org chat policy RPC handlers."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatBroadcastMinRole,
    ChatPolicy,
    GetChatPolicyRequest,
    GetChatPolicyResponse,
    UpdateChatPolicyRequest,
    UpdateChatPolicyResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context, resolve_organization_id
from uniffy.domains.chat.policy import (
    BroadcastMinRole,
    ResolvedChatPolicy,
    get_chat_policy_view,
    update_chat_policy,
)

logger = logger.bind(component="chat.policy_handlers")

_MIN_ROLE_TO_PROTO = {
    BroadcastMinRole.MEMBER: ChatBroadcastMinRole.CHAT_BROADCAST_MIN_ROLE_MEMBER,
    BroadcastMinRole.ADMIN: ChatBroadcastMinRole.CHAT_BROADCAST_MIN_ROLE_ADMIN,
}
_MIN_ROLE_FROM_PROTO = {proto: role for role, proto in _MIN_ROLE_TO_PROTO.items()}


def _policy_to_proto(policy: ResolvedChatPolicy) -> ChatPolicy:
    return ChatPolicy(
        organization_id=str(policy.organization_id),
        broadcast_min_role=_MIN_ROLE_TO_PROTO[policy.broadcast_min_role],
        broadcast_confirm_threshold=policy.broadcast_confirm_threshold,
    )


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class ChatPolicyHandlers:
    async def get_chat_policy(
        self,
        request: GetChatPolicyRequest,
        ctx: RequestContext,
    ) -> GetChatPolicyResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = resolve_organization_id(ctx, request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                policy = await get_chat_policy_view(session, user_id, org_id)
                return GetChatPolicyResponse(policy=_policy_to_proto(policy))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def update_chat_policy(
        self,
        request: UpdateChatPolicyRequest,
        ctx: RequestContext,
    ) -> UpdateChatPolicyResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = resolve_organization_id(ctx, request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        min_role = _MIN_ROLE_FROM_PROTO.get(request.broadcast_min_role)
        if min_role is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "broadcast_min_role is required")

        try:
            async with open_session() as session:
                policy = await update_chat_policy(
                    session,
                    user_id,
                    org_id,
                    broadcast_min_role=min_role,
                    broadcast_confirm_threshold=request.broadcast_confirm_threshold,
                )
                return UpdateChatPolicyResponse(policy=_policy_to_proto(policy))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)
