"""Search RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.search.v1.search_pb2 import (
    DeleteItemRequest,
    DeleteItemResponse,
    GetReferencesRequest,
    GetReferencesResponse,
    IndexItemRequest,
    IndexItemResponse,
    ResolveUrnsRequest,
    ResolveUrnsResponse,
    SearchRequest,
    SearchResponse,
)

from uniffy.core.types import AccessMode, ContentRole
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.search.converters import (
    proto_to_entity_type,
    search_result_to_proto,
    search_result_to_urn_metadata,
)
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.parser import parse_search_query


class SearchHandlers:
    """Search RPC handlers."""

    async def search(
        self,
        request: SearchRequest,
        ctx: RequestContext,
    ) -> SearchResponse:
        """
        Perform a global fuzzy search with keyword filters.

        Supports Google-style filter syntax in the query:
        - Type filters: note:, file:, user:, calendar:
        - Tag filters: tag:work
        - Project filters: project:xyz
        - Ownership: my: (current user's content)

        Returns content the user has permission to see, ranked by relevance.
        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        # Parse the query to extract filters
        parsed = parse_search_query(request.query)

        # Get the free text portion (after removing filter keywords)
        query_text = parsed.text

        # Check if we have any search criteria (text or filters)
        has_filters = (
            parsed.type_filters
            or parsed.tags
            or parsed.my_content_only
            or parsed.owner
            or request.type_filters
            or request.tag_filters
            or request.my_content_only
            or request.owner_filter
        )

        # If no query text and no filters, return empty
        if not query_text and not has_filters:
            return SearchResponse(items=[])

        # Merge type filters from parsed query and explicit request
        type_filters: list[str] = []
        if parsed.type_filters:
            type_filters.extend(parsed.type_filters)
        if request.type_filters:
            for tf in request.type_filters:
                entity_type = proto_to_entity_type(tf)
                if entity_type and entity_type not in type_filters:
                    type_filters.append(entity_type)

        # Merge tag filters
        tag_filters: list[str] = list(parsed.tags)
        if request.tag_filters:
            for tag in request.tag_filters:
                if tag not in tag_filters:
                    tag_filters.append(tag)

        # Ownership filters
        my_content_only = parsed.my_content_only or request.my_content_only

        # Owner filter (parsed owner username would need lookup, for now use explicit)
        owner_filter: UUID | None = None
        if request.owner_filter:
            # Owner filter might be a username - would need user lookup
            # For now, skip invalid UUIDs
            with contextlib.suppress(ValueError):
                owner_filter = UUID(request.owner_filter)

        # Build exclude type filters
        exclude_type_filters: list[str] = []
        if request.exclude_types:
            for et in request.exclude_types:
                entity_type = proto_to_entity_type(et)
                if entity_type and entity_type not in exclude_type_filters:
                    exclude_type_filters.append(entity_type)

        # Set limit with bounds
        limit = min(max(request.limit or 20, 1), 100)

        # Metadata filters (e.g., channel_id, sender_id for chat)
        metadata_filters: dict[str, str] | None = None
        if request.metadata_filters:
            metadata_filters = dict(request.metadata_filters)

        try:
            async with open_session() as session:
                ops = SearchOperations(session)
                results, _total = await ops.search(
                    user_id=user_id,
                    organization_id=organization_id,
                    query_text=query_text,
                    type_filters=type_filters if type_filters else None,
                    exclude_type_filters=exclude_type_filters if exclude_type_filters else None,
                    tag_filters=tag_filters if tag_filters else None,
                    my_content_only=my_content_only,
                    owner_filter=owner_filter,
                    metadata_filters=metadata_filters,
                    limit=limit,
                )

                # Convert to proto (score is in SearchResult.search_score)
                items = [search_result_to_proto(item) for item in results]

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
            access_mode = AccessMode(request.metadata.get("access_mode", AccessMode.OWNER_ONLY))
            baseline_role_str = request.metadata.get("baseline_role") or None
            baseline_role = ContentRole(baseline_role_str) if baseline_role_str else None

            async with open_session() as session:
                ops = SearchOperations(session)
                await ops.index_item(
                    organization_id=organization_id,
                    urn=request.urn,
                    entity_type=entity_type,
                    title=request.title,
                    url_path=request.url,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
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
            async with open_session() as session:
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
            async with open_session() as session:
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

    async def resolve_urns(
        self,
        request: ResolveUrnsRequest,
        ctx: RequestContext,
    ) -> ResolveUrnsResponse:
        """
        Resolve metadata for a batch of URNs.

        Returns metadata for URNs the user has permission to view.
        Missing or inaccessible URNs are omitted from the response.
        """
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        # Validate URNs list
        if not request.urns:
            return ResolveUrnsResponse(resolved={})

        if len(request.urns) > 100:
            raise ConnectError(Code.INVALID_ARGUMENT, "Maximum 100 URNs allowed per request")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SearchOperations(session)
                results = await ops.resolve_urns(
                    user_id=user_id,
                    organization_id=organization_id,
                    urns=list(request.urns),
                )

                # Convert to proto map
                resolved = {
                    urn: search_result_to_urn_metadata(item) for urn, item in results.items()
                }

                return ResolveUrnsResponse(resolved=resolved)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error resolving URNs: {e}")
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")
