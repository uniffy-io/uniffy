"""ConnectRPC handlers for private bookmarks."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.bookmarks.v1.bookmarks_pb2 import (
    BulkCheckBookmarksRequest,
    BulkCheckBookmarksResponse,
    ListBookmarkItemsRequest,
    ListBookmarkItemsResponse,
    ToggleBookmarkRequest,
    ToggleBookmarkResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import CONTENT_TYPE_FROM_PROTO
from uniffy.core.errors import UNIFFYError
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.bookmarks.converters import bookmark_item_to_proto, bookmark_to_proto
from uniffy.domains.bookmarks.operations import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    BookmarksOperations,
)

logger = logger.bind(component="bookmarks.handlers")


class BookmarksHandlers:
    async def toggle_bookmark(
        self,
        request: ToggleBookmarkRequest,
        ctx: RequestContext,
    ) -> ToggleBookmarkResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        if not request.urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "URN is required")

        try:
            async with open_session() as session:
                is_bookmarked, bookmark = await BookmarksOperations(session).toggle(
                    user_id,
                    organization_id,
                    request.urn,
                )
                response = ToggleBookmarkResponse(is_bookmarked=is_bookmarked)
                if bookmark is not None:
                    response.bookmark.CopyFrom(bookmark_to_proto(bookmark))
                return response
        except ConnectError, UNIFFYError:
            raise
        except Exception:
            logger.exception("Bookmark toggle failed")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_bookmark_items(
        self,
        request: ListBookmarkItemsRequest,
        ctx: RequestContext,
    ) -> ListBookmarkItemsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        content_types = _content_types_from_proto(request.content_types)
        page_size = min(request.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        page_token = request.page_token if request.HasField("page_token") else None

        try:
            async with open_session() as session:
                page = await BookmarksOperations(session).list_bookmark_items(
                    user_id,
                    organization_id,
                    content_types=content_types,
                    page_size=page_size,
                    page_token=page_token,
                )
                response = ListBookmarkItemsResponse(
                    items=[bookmark_item_to_proto(item) for item in page.items]
                )
                if page.next_page_token is not None:
                    response.next_page_token = page.next_page_token
                return response
        except ConnectError, UNIFFYError:
            raise
        except Exception:
            logger.exception("Resolved bookmark listing failed")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def bulk_check_bookmarks(
        self,
        request: BulkCheckBookmarksRequest,
        ctx: RequestContext,
    ) -> BulkCheckBookmarksResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        urns = list(request.urns)[:100]

        try:
            async with open_session() as session:
                bookmarked_urns = await BookmarksOperations(session).bulk_check(
                    user_id,
                    organization_id,
                    urns,
                )
                response = BulkCheckBookmarksResponse()
                response.bookmarked_urns.update(bookmarked_urns)
                return response
        except ConnectError, UNIFFYError:
            raise
        except Exception:
            logger.exception("Bulk bookmark check failed")
            raise ConnectError(Code.INTERNAL, "Internal server error")


def _content_types_from_proto(values: list[int]) -> tuple[ContentType, ...]:
    content_types: list[ContentType] = []
    for value in values:
        content_type = CONTENT_TYPE_FROM_PROTO.get(value)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid bookmark content type")
        if content_type not in content_types:
            content_types.append(content_type)
    return tuple(content_types)
