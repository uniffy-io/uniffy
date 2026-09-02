"""Org chat policy RPC handlers."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatBroadcastMinRole,
    ChatEditHistoryVisibility,
    ChatPolicy,
    GetChatPolicyRequest,
    GetChatPolicyResponse,
    UpdateChatPolicyRequest,
    UpdateChatPolicyResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.chat.policies.operations import (
    BroadcastMinRole,
    EditHistoryVisibility,
    ResolvedChatPolicy,
    get_chat_policy_view,
    update_chat_policy,
)
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="chat.policies.handlers")

_MIN_ROLE_TO_PROTO = {
    BroadcastMinRole.MEMBER: ChatBroadcastMinRole.CHAT_BROADCAST_MIN_ROLE_MEMBER,
    BroadcastMinRole.ADMIN: ChatBroadcastMinRole.CHAT_BROADCAST_MIN_ROLE_ADMIN,
}
_MIN_ROLE_FROM_PROTO = {proto: role for role, proto in _MIN_ROLE_TO_PROTO.items()}

_EDIT_HISTORY_TO_PROTO = {
    EditHistoryVisibility.ADMINS: ChatEditHistoryVisibility.CHAT_EDIT_HISTORY_VISIBILITY_ADMINS,
    EditHistoryVisibility.EVERYONE: (
        ChatEditHistoryVisibility.CHAT_EDIT_HISTORY_VISIBILITY_EVERYONE
    ),
}
_EDIT_HISTORY_FROM_PROTO = {proto: value for value, proto in _EDIT_HISTORY_TO_PROTO.items()}


def _policy_to_proto(policy: ResolvedChatPolicy) -> ChatPolicy:
    proto = ChatPolicy(
        organization_id=str(policy.organization_id),
        broadcast_min_role=_MIN_ROLE_TO_PROTO[policy.broadcast_min_role],
        broadcast_confirm_threshold=policy.broadcast_confirm_threshold,
        edit_history_visible_to=_EDIT_HISTORY_TO_PROTO[policy.edit_history_visible_to],
        agents_enabled=policy.agents_enabled,
    )
    # An absent edit window means unlimited editing.
    if policy.edit_window_minutes is not None:
        proto.edit_window_minutes = policy.edit_window_minutes
    return proto


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
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
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
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        min_role = _MIN_ROLE_FROM_PROTO.get(request.broadcast_min_role)
        if min_role is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "broadcast_min_role is required")
        edit_history_visible_to = _EDIT_HISTORY_FROM_PROTO.get(request.edit_history_visible_to)
        if edit_history_visible_to is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "edit_history_visible_to is required")
        edit_window_minutes = (
            request.edit_window_minutes if request.HasField("edit_window_minutes") else None
        )

        try:
            async with open_session() as session:
                policy = await update_chat_policy(
                    session,
                    user_id,
                    org_id,
                    broadcast_min_role=min_role,
                    broadcast_confirm_threshold=request.broadcast_confirm_threshold,
                    edit_window_minutes=edit_window_minutes,
                    edit_history_visible_to=edit_history_visible_to,
                    agents_enabled=request.agents_enabled,
                )
                return UpdateChatPolicyResponse(policy=_policy_to_proto(policy))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)
