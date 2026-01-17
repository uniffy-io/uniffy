"""Search RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.db import get_async_session
from uwos.domains.auth.context import get_user_id_from_context
from uwos.domains.search.converters import (
    proto_to_entity_type,
    search_result_to_proto,
)
from uwos.domains.search.operations import SearchOperations
from uwos.gen.search.v1.search_pb2 import (
    DeleteItemRequest,
    DeleteItemResponse,
    GetReferencesRequest,
    GetReferencesResponse,
    IndexItemRequest,
    IndexItemResponse,
    SearchRequest,
    SearchResponse,
)


class SearchHandlers:
    """Search RPC handlers."""

    async def search(
        self,
        request: SearchRequest,
        ctx: RequestContext,
    ) -> SearchResponse:
        """
        Perform a global fuzzy search.

        Returns content the user has permission to see, ranked by relevance.
        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        # Validate query
        query_text = request.query.strip()
        if not query_text:
            return SearchResponse(items=[])

        # Parse type filters
        type_filters: list[str] | None = None
        if request.type_filters:
            type_filters = [
                entity_type
                for tf in request.type_filters
                if (entity_type := proto_to_entity_type(tf)) is not None
            ]

        # Set limit with bounds
        limit = min(max(request.limit or 20, 1), 100)

        try:
            async for session in get_async_session():
                ops = SearchOperations(session)
                results = await ops.search(
                    user_id=user_id,
                    organization_id=organization_id,
                    query_text=query_text,
                    type_filters=type_filters,
                    limit=limit,
                )

                # Convert to proto
                items = [search_result_to_proto(item, score) for item, score in results]

                return SearchResponse(items=items)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error performing search: {e}")
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def index_item(
        self,
        request: IndexItemRequest,
        ctx: RequestContext,
    ) -> IndexItemResponse:
        """
        Index an item in the search index.

        This is typically called internally by other services
        when content is created or updated.
        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        # Validate required fields
        if not request.urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "URN is required")
        if not request.title:
            raise ConnectError(Code.INVALID_ARGUMENT, "Title is required")
        if not request.url:
            raise ConnectError(Code.INVALID_ARGUMENT, "URL is required")

        entity_type = proto_to_entity_type(request.type)
        if not entity_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid entity type")

        try:
            # For internal indexing, we need owner info from metadata
            # This RPC is mainly for external/manual indexing
            owner_id_str = request.metadata.get("owner_id")
            if not owner_id_str:
                raise ConnectError(Code.INVALID_ARGUMENT, "owner_id required in metadata")

            owner_id = UUID(owner_id_str)
            visibility = request.metadata.get("visibility", "PRIVATE")

            async for session in get_async_session():
                ops = SearchOperations(session)
                await ops.index_item(
                    organization_id=organization_id,
                    urn=request.urn,
                    entity_type=entity_type,
                    title=request.title,
                    url_path=request.url,
                    visibility=visibility,
                    owner_id=owner_id,
                    keywords=request.content if request.content else None,
                )

                return IndexItemResponse(success=True)

        except ConnectError:
            raise
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error indexing item: {e}")
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def delete_item(
        self,
        request: DeleteItemRequest,
        ctx: RequestContext,
    ) -> DeleteItemResponse:
        """
        Remove an item from the search index.

        Called when content is permanently deleted.
        """
        if not request.urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "URN is required")

        try:
            async for session in get_async_session():
                ops = SearchOperations(session)
                await ops.delete_item(request.urn)

                return DeleteItemResponse(success=True)

        except Exception as e:
            logger.exception(f"Error deleting item: {e}")
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def get_references(
        self,
        request: GetReferencesRequest,
        ctx: RequestContext,
    ) -> GetReferencesResponse:
        """
        Get all content that references a specific URN.

        Returns content items that have the target URN in their
        outgoing_references, effectively providing universal backlinks.
        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        if not request.target_urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "target_urn is required")

        user_id = get_user_id_from_context(ctx)

        # Parse type filters
        type_filters: list[str] | None = None
        if request.type_filters:
            type_filters = [
                entity_type
                for tf in request.type_filters
                if (entity_type := proto_to_entity_type(tf)) is not None
            ]

        # Set limit with bounds
        limit = min(max(request.limit or 50, 1), 100)

        try:
            async for session in get_async_session():
                ops = SearchOperations(session)
                results, total = await ops.get_references(
                    user_id=user_id,
                    organization_id=organization_id,
                    target_urn=request.target_urn,
                    type_filters=type_filters,
                    limit=limit,
                )

                # Convert to proto
                items = [search_result_to_proto(item, 1.0) for item in results]

                return GetReferencesResponse(items=items, total_count=total)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting references: {e}")
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")
