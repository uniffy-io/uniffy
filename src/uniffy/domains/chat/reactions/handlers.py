"""Chat reaction RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    AddReactionRequest,
    AddReactionResponse,
    ReactionGroup,
    RemoveReactionRequest,
    RemoveReactionResponse,
)

from uniffy.core.auth.principal import (
    current_sender_info,
    current_user_id,
    resolve_organization_id,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import open_session
from uniffy.domains.chat.reactions.operations import ChatReactionOperations

logger = logger.bind(component="chat.reactions.handlers")


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class ReactionHandlers:
    async def add_reaction(
        self,
        request: AddReactionRequest,
        ctx: RequestContext,
    ) -> AddReactionResponse:
        user_id = current_user_id()
        jwt_name, _ = current_sender_info()
        try:
            org_id = resolve_organization_id(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatReactionOperations(session)
                await ops.add_reaction(
                    user_id,
                    org_id,
                    channel_id,
                    message_id,
                    request.emoji,
                    display_name=jwt_name,
                )

                reactions = await ops.get_reactions_for_messages([message_id], user_id)
                groups = reactions.get(message_id, [])
                for g in groups:
                    if g["emoji"] == request.emoji:
                        return AddReactionResponse(
                            reaction=ReactionGroup(
                                emoji=g["emoji"],
                                count=g["count"],
                                current_user_reacted=g["current_user_reacted"],
                            )
                        )

                return AddReactionResponse(
                    reaction=ReactionGroup(
                        emoji=request.emoji,
                        count=1,
                        current_user_reacted=True,
                    )
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def remove_reaction(
        self,
        request: RemoveReactionRequest,
        ctx: RequestContext,
    ) -> RemoveReactionResponse:
        user_id = current_user_id()
        jwt_name, _ = current_sender_info()
        try:
            org_id = resolve_organization_id(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatReactionOperations(session)
                await ops.remove_reaction(
                    user_id,
                    org_id,
                    channel_id,
                    message_id,
                    request.emoji,
                    display_name=jwt_name,
                )
                return RemoveReactionResponse()
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)
