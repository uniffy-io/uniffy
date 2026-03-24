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

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_sender_info_from_context, get_user_id_from_context
from uniffy.domains.chat.reactions.operations import ChatReactionOperations


def _handle_error(e: Exception) -> None:
    """Map domain errors to ConnectRPC errors."""
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class ReactionHandlers:
    """Reaction RPC handlers."""

    async def add_reaction(
        self,
        request: AddReactionRequest,
        ctx: RequestContext,
    ) -> AddReactionResponse:
        """Add a reaction to a message."""
        user_id = get_user_id_from_context(ctx)
        jwt_name, _ = get_sender_info_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatReactionOperations(session)
                await ops.add_reaction(
                    user_id, org_id, channel_id, message_id, request.emoji,
                    display_name=jwt_name,
                )

                # Build reaction group for response
                reactions = await ops.get_reactions_for_messages(
                    [message_id], user_id
                )
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
        """Remove a reaction from a message."""
        user_id = get_user_id_from_context(ctx)
        jwt_name, _ = get_sender_info_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatReactionOperations(session)
                await ops.remove_reaction(
                    user_id, org_id, channel_id, message_id, request.emoji,
                    display_name=jwt_name,
                )
                return RemoveReactionResponse()
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)
