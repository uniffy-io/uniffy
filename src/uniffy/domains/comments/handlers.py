"""Comments RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.comments.v1.comments_pb2 import (
    AddReactionRequest,
    AddReactionResponse,
    CreateCommentRequest,
    CreateCommentResponse,
    DeleteCommentRequest,
    DeleteCommentResponse,
    GetCommentCountsRequest,
    GetCommentCountsResponse,
    GetCommentRequest,
    GetCommentResponse,
    ListCommentsRequest,
    ListCommentsResponse,
    RemoveReactionRequest,
    RemoveReactionResponse,
    ReopenCommentRequest,
    ReopenCommentResponse,
    ResolveCommentRequest,
    ResolveCommentResponse,
    UpdateCommentRequest,
    UpdateCommentResponse,
)

from uniffy.core.converters import content_type_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.comments.converters import (
    anchor_type_from_proto,
    comment_to_proto,
)
from uniffy.domains.comments.operations import CommentOperations
from uniffy.domains.comments.queries import aggregate_reactions


class CommentsHandlers:
    """RPC handlers for comments service."""

    async def create_comment(
        self,
        request: CreateCommentRequest,
        ctx: RequestContext,
    ) -> CreateCommentResponse:
        """
        Handle create_comment RPC call.

        Parameters
        ----------
        request : CreateCommentRequest
            The create request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        CreateCommentResponse
            Response with created comment.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        content_type = content_type_from_proto(request.content_type)

        if not request.body.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Comment body is required")

        parent_comment_id = None
        if request.HasField("parent_comment_id"):
            try:
                parent_comment_id = UUID(request.parent_comment_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_comment_id format")

        anchor_type = anchor_type_from_proto(request.anchor_type)

        # Convert Struct to dict
        anchor_data = None
        if request.HasField("anchor_data"):
            from google.protobuf.json_format import MessageToDict

            anchor_data = MessageToDict(request.anchor_data)

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                comment, author_name, author_avatar = await ops.create_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    body=request.body,
                    anchor_type=anchor_type,
                    anchor_data=anchor_data,
                    parent_comment_id=parent_comment_id,
                )

                proto_comment = comment_to_proto(
                    comment=comment,
                    author_name=author_name,
                    author_avatar_url=author_avatar,
                    reply_count=0,
                    reactions=[],
                    current_user_id=str(user_id),
                )

                response = CreateCommentResponse()
                response.comment.CopyFrom(proto_comment)
                return response

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_comment(
        self,
        request: UpdateCommentRequest,
        ctx: RequestContext,
    ) -> UpdateCommentResponse:
        """
        Handle update_comment RPC call.

        Parameters
        ----------
        request : UpdateCommentRequest
            The update request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        UpdateCommentResponse
            Response with updated comment.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        if not request.body.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Comment body is required")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                comment, author_name, author_avatar = await ops.update_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                    body=request.body,
                )

                reactions = await aggregate_reactions(session, comment.id)

                proto_comment = comment_to_proto(
                    comment=comment,
                    author_name=author_name,
                    author_avatar_url=author_avatar,
                    reply_count=0,
                    reactions=reactions,
                    current_user_id=str(user_id),
                )

                response = UpdateCommentResponse()
                response.comment.CopyFrom(proto_comment)
                return response

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_comment(
        self,
        request: DeleteCommentRequest,
        ctx: RequestContext,
    ) -> DeleteCommentResponse:
        """
        Handle delete_comment RPC call.

        Parameters
        ----------
        request : DeleteCommentRequest
            The delete request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteCommentResponse
            Response with success flag.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                success = await ops.delete_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                )
                return DeleteCommentResponse(success=success)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_comments(
        self,
        request: ListCommentsRequest,
        ctx: RequestContext,
    ) -> ListCommentsResponse:
        """
        Handle list_comments RPC call.

        Parameters
        ----------
        request : ListCommentsRequest
            The list request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListCommentsResponse
            Response with comments list and counts.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        content_type = content_type_from_proto(request.content_type)

        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 50
        page_size = min(page_size, 100)

        is_resolved = None
        if request.HasField("is_resolved"):
            is_resolved = request.is_resolved

        anchor_type = None
        if request.HasField("anchor_type"):
            anchor_type = anchor_type_from_proto(request.anchor_type)

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                (
                    comments_data,
                    total_count,
                    open_count,
                    resolved_count,
                ) = await ops.list_comments(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    is_resolved=is_resolved,
                    anchor_type=anchor_type,
                    page=page,
                    page_size=page_size,
                )

                proto_comments = []
                for comment, author_name, avatar_url, reply_count, reactions in comments_data:
                    proto_comments.append(
                        comment_to_proto(
                            comment=comment,
                            author_name=author_name,
                            author_avatar_url=avatar_url,
                            reply_count=reply_count,
                            reactions=reactions,
                            current_user_id=str(user_id),
                        )
                    )

                return ListCommentsResponse(
                    comments=proto_comments,
                    total_count=total_count,
                    open_count=open_count,
                    resolved_count=resolved_count,
                )

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing comments: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_comment(
        self,
        request: GetCommentRequest,
        ctx: RequestContext,
    ) -> GetCommentResponse:
        """
        Handle get_comment RPC call.

        Parameters
        ----------
        request : GetCommentRequest
            The get request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetCommentResponse
            Response with comment and replies.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                (
                    comment,
                    author_name,
                    author_avatar,
                    reply_count,
                    reactions,
                    replies,
                ) = await ops.get_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                )

                # Convert replies to proto
                proto_replies = []
                for (
                    reply,
                    reply_name,
                    reply_avatar,
                    reply_reply_count,
                    reply_reactions,
                ) in replies:
                    proto_replies.append(
                        comment_to_proto(
                            comment=reply,
                            author_name=reply_name,
                            author_avatar_url=reply_avatar,
                            reply_count=reply_reply_count,
                            reactions=reply_reactions,
                            current_user_id=str(user_id),
                        )
                    )

                proto_comment = comment_to_proto(
                    comment=comment,
                    author_name=author_name,
                    author_avatar_url=author_avatar,
                    reply_count=reply_count,
                    reactions=reactions,
                    current_user_id=str(user_id),
                    replies=proto_replies,
                )

                response = GetCommentResponse()
                response.comment.CopyFrom(proto_comment)
                return response

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def resolve_comment(
        self,
        request: ResolveCommentRequest,
        ctx: RequestContext,
    ) -> ResolveCommentResponse:
        """
        Handle resolve_comment RPC call.

        Parameters
        ----------
        request : ResolveCommentRequest
            The resolve request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ResolveCommentResponse
            Response with resolved comment.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                comment, author_name, author_avatar = await ops.resolve_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                )

                reactions = await aggregate_reactions(session, comment.id)

                proto_comment = comment_to_proto(
                    comment=comment,
                    author_name=author_name,
                    author_avatar_url=author_avatar,
                    reply_count=0,
                    reactions=reactions,
                    current_user_id=str(user_id),
                )

                response = ResolveCommentResponse()
                response.comment.CopyFrom(proto_comment)
                return response

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error resolving comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def reopen_comment(
        self,
        request: ReopenCommentRequest,
        ctx: RequestContext,
    ) -> ReopenCommentResponse:
        """
        Handle reopen_comment RPC call.

        Parameters
        ----------
        request : ReopenCommentRequest
            The reopen request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ReopenCommentResponse
            Response with reopened comment.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                comment, author_name, author_avatar = await ops.reopen_comment(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                )

                reactions = await aggregate_reactions(session, comment.id)

                proto_comment = comment_to_proto(
                    comment=comment,
                    author_name=author_name,
                    author_avatar_url=author_avatar,
                    reply_count=0,
                    reactions=reactions,
                    current_user_id=str(user_id),
                )

                response = ReopenCommentResponse()
                response.comment.CopyFrom(proto_comment)
                return response

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error reopening comment: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_reaction(
        self,
        request: AddReactionRequest,
        ctx: RequestContext,
    ) -> AddReactionResponse:
        """
        Handle add_reaction RPC call.

        Parameters
        ----------
        request : AddReactionRequest
            The add reaction request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AddReactionResponse
            Response with success flag.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        if not request.emoji:
            raise ConnectError(Code.INVALID_ARGUMENT, "Emoji is required")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                success = await ops.add_reaction(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                    emoji=request.emoji,
                )
                return AddReactionResponse(success=success)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding reaction: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_reaction(
        self,
        request: RemoveReactionRequest,
        ctx: RequestContext,
    ) -> RemoveReactionResponse:
        """
        Handle remove_reaction RPC call.

        Parameters
        ----------
        request : RemoveReactionRequest
            The remove reaction request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        RemoveReactionResponse
            Response with success flag.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            comment_id = UUID(request.comment_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid UUID format")

        if not request.emoji:
            raise ConnectError(Code.INVALID_ARGUMENT, "Emoji is required")

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                success = await ops.remove_reaction(
                    user_id=user_id,
                    organization_id=organization_id,
                    comment_id=comment_id,
                    emoji=request.emoji,
                )
                return RemoveReactionResponse(success=success)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing reaction: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_comment_counts(
        self,
        request: GetCommentCountsRequest,
        ctx: RequestContext,
    ) -> GetCommentCountsResponse:
        """
        Handle get_comment_counts RPC call.

        Parameters
        ----------
        request : GetCommentCountsRequest
            The counts request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetCommentCountsResponse
            Response with counts map.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        content_refs = []
        for ref in request.content_refs[:100]:  # Limit to 100
            try:
                ct = content_type_from_proto(ref.content_type)
                cid = UUID(ref.content_id)
                content_refs.append((ct, cid))
            except ValueError, KeyError:
                continue

        try:
            async for session in get_async_session():
                ops = CommentOperations(session)
                counts = await ops.get_comment_counts(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_refs=content_refs,
                )

                response = GetCommentCountsResponse()
                for key, count in counts.items():
                    response.counts[key] = count
                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting comment counts: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
