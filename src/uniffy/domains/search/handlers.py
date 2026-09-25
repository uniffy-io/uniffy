import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.search.v1.search_pb import (
    ContentGraphEdge,
    GetContentGraphRequest,
    GetContentGraphResponse,
    GetReferencesRequest,
    GetReferencesResponse,
    ResolveUrnsRequest,
    ResolveUrnsResponse,
    SearchRequest,
    SearchResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.domains.search.converters import (
    proto_to_entity_type,
    search_result_to_proto,
    search_result_to_urn_metadata,
)
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.parser import parse_search_query
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="search.handlers")


class SearchHandlers:
    search_engine: WorkspaceSearch

    async def search(
        self,
        request: SearchRequest,
        ctx: RequestContext,
    ) -> SearchResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        parsed = parse_search_query(request.query)
        query_text = parsed.text

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

        if not query_text and not has_filters:
            return SearchResponse(items=[])

        type_filters: list[str] = []
        if parsed.type_filters:
            type_filters.extend(parsed.type_filters)
        if request.type_filters:
            for tf in request.type_filters:
                entity_type = proto_to_entity_type(tf)
                if entity_type and entity_type not in type_filters:
                    type_filters.append(entity_type)

        tag_filters: list[str] = list(parsed.tags)
        if request.tag_filters:
            for tag in request.tag_filters:
                if tag not in tag_filters:
                    tag_filters.append(tag)

        my_content_only = parsed.my_content_only or request.my_content_only

        owner_filter: UUID | None = None
        if request.owner_filter:
            # Owner filter accepts a UUID today; username resolution is not wired yet.
            with contextlib.suppress(ValueError):
                owner_filter = UUID(request.owner_filter)

        type_priority: list[str] = []
        if request.type_priority:
            for tp in request.type_priority:
                entity_type = proto_to_entity_type(tp)
                if entity_type and entity_type not in type_priority:
                    type_priority.append(entity_type)

        limit = min(max(request.limit or 20, 1), 100)
        offset = max(request.offset, 0)

        metadata_filters: dict[str, str] | None = None
        if request.metadata_filters:
            metadata_filters = dict(request.metadata_filters)

        try:
            async with open_session() as session:
                ops = SearchOperations(session, self.search_engine)
                results, has_more, next_offset = await ops.search(
                    user_id=user_id,
                    organization_id=organization_id,
                    query_text=query_text,
                    type_filters=type_filters if type_filters else None,
                    tag_filters=tag_filters if tag_filters else None,
                    my_content_only=my_content_only,
                    owner_filter=owner_filter,
                    metadata_filters=metadata_filters,
                    limit=limit,
                    offset=offset,
                    type_priority=type_priority if type_priority else None,
                    name_matches_only=request.name_matches_only,
                )

                items = [search_result_to_proto(item) for item in results]

                return SearchResponse(
                    items=items,
                    has_more=has_more,
                    next_offset=next_offset,
                )

        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error performing search: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_references(
        self,
        request: GetReferencesRequest,
        ctx: RequestContext,
    ) -> GetReferencesResponse:
        # Universal backlinks: returns content whose outgoing_references contain target_urn.
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.target_urn:
            raise ConnectError(Code.INVALID_ARGUMENT, "target_urn is required")

        type_filters: list[str] | None = None
        if request.type_filters:
            type_filters = [
                entity_type
                for tf in request.type_filters
                if (entity_type := proto_to_entity_type(tf)) is not None
            ]

        limit = min(max(request.limit or 50, 1), 100)

        try:
            async with open_session() as session:
                ops = SearchOperations(session, self.search_engine)
                results, total = await ops.get_references(
                    user_id=user_id,
                    organization_id=organization_id,
                    target_urn=request.target_urn,
                    type_filters=type_filters,
                    limit=limit,
                )

                items = [search_result_to_proto(item, 1.0) for item in results]

                return GetReferencesResponse(items=items, total_count=total)

        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error getting references: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_content_graph(
        self,
        request: GetContentGraphRequest,
        ctx: RequestContext,
    ) -> GetContentGraphResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                ops = SearchOperations(session, self.search_engine)
                edges, truncated = await ops.get_content_graph(
                    user_id=user_id,
                    organization_id=organization_id,
                )

            return GetContentGraphResponse(
                edges=[ContentGraphEdge(source_urn=s, target_urn=t) for s, t in edges],
                truncated=truncated,
            )

        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception:
            logger.exception("Content graph build failed")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def resolve_urns(
        self,
        request: ResolveUrnsRequest,
        ctx: RequestContext,
    ) -> ResolveUrnsResponse:
        # URNs the user cannot view or that are missing are returned as tombstones
        # by SearchOperations.resolve_urns so chip rendering can show a deleted state.
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.urns:
            return ResolveUrnsResponse(resolved={})

        if len(request.urns) > 100:
            raise ConnectError(Code.INVALID_ARGUMENT, "Maximum 100 URNs allowed per request")

        try:
            async with open_session() as session:
                ops = SearchOperations(session, self.search_engine)
                results = await ops.resolve_urns(
                    user_id=user_id,
                    organization_id=organization_id,
                    urns=list(request.urns),
                )

                resolved = {
                    urn: search_result_to_urn_metadata(item) for urn, item in results.items()
                }

                return ResolveUrnsResponse(resolved=resolved)

        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error resolving URNs: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
