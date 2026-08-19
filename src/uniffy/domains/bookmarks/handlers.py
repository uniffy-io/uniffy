"""Bookmarks RPC handlers - thin layer delegating to operations."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.bookmarks.v1.bookmarks_pb2 import (
    BulkCheckBookmarksRequest,
    BulkCheckBookmarksResponse,
    ListBookmarksRequest,
    ListBookmarksResponse,
    ToggleBookmarkRequest,
    ToggleBookmarkResponse,
)

from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context, resolve_organization_id
from uniffy.domains.bookmarks.converters import bookmark_to_proto
from uniffy.domains.bookmarks.operations import BookmarksOperations

logger = logger.bind(component="bookmarks.handlers")


class BookmarksHandlers:
    """RPC handlers for bookmarks service."""

    async def toggle_bookmark(
        self,
        request: ToggleBookmarkRequest,
        ctx: RequestContext,
    ) -> ToggleBookmarkResponse:
        """
        Handle toggle_bookmark RPC call.

        Toggles a bookmark on a URN for the authenticated user.

        Parameters
        ----------
        request : ToggleBookmarkRequest
            The toggle request with organization_id and urn.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ToggleBookmarkResponse
            Response with is_bookmarked flag and bookmark data.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = resolve_organization_id(ctx, request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        if not request.urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "URN is required")

        try:
            async with open_session() as session:
                ops = BookmarksOperations(session)
                is_bookmarked, bookmark = await ops.toggle(
                    user_id=user_id,
                    organization_id=organization_id,
                    urn=request.urn,
                )

                response = ToggleBookmarkResponse(is_bookmarked=is_bookmarked)
                if bookmark:
                    response.bookmark.CopyFrom(bookmark_to_proto(bookmark))

                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error toggling bookmark: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_bookmarks(
        self,
        request: ListBookmarksRequest,
        ctx: RequestContext,
    ) -> ListBookmarksResponse:
        """
        Handle list_bookmarks RPC call.

        Lists all bookmarks for the authenticated user in an organization.

        Parameters
        ----------
        request : ListBookmarksRequest
            The list request with organization_id and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListBookmarksResponse
            List of bookmarks and total count.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = resolve_organization_id(ctx, request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        # Default pagination
        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 50
        page_size = min(page_size, 100)  # Cap at 100

        try:
            async with open_session() as session:
                ops = BookmarksOperations(session)
                bookmarks, total_count = await ops.list_bookmarks(
                    user_id=user_id,
                    organization_id=organization_id,
                    page=page,
                    page_size=page_size,
                )

                return ListBookmarksResponse(
                    bookmarks=[bookmark_to_proto(b) for b in bookmarks],
                    total_count=total_count,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing bookmarks: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_check_bookmarks(
        self,
        request: BulkCheckBookmarksRequest,
        ctx: RequestContext,
    ) -> BulkCheckBookmarksResponse:
        """
        Handle bulk_check_bookmarks RPC call.

        Checks multiple URNs for bookmark status.

        Parameters
        ----------
        request : BulkCheckBookmarksRequest
            The request with organization_id and list of URNs.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        BulkCheckBookmarksResponse
            Map of URN to bookmark status.

        """
        user_id = get_user_id_from_context(ctx)

        # Validate organization_id is provided (we don't actually use it for bulk check
        # since bookmarks are unique per user+urn, but we validate for consistency)
        if request.organization_id:
            try:
                resolve_organization_id(ctx, request.organization_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        # Limit the number of URNs to check
        urns = list(request.urns)[:100]

        try:
            async with open_session() as session:
                ops = BookmarksOperations(session)
                bookmarked_urns = await ops.bulk_check(
                    user_id=user_id,
                    urns=urns,
                )

                response = BulkCheckBookmarksResponse()
                for urn, is_bookmarked in bookmarked_urns.items():
                    response.bookmarked_urns[urn] = is_bookmarked

                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error bulk checking bookmarks: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
