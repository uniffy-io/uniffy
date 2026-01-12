"""Search service implementation."""

import logging
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.request import RequestContext
from sqlalchemy import delete, desc, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from uwos.db import get_async_session
from uwos.gen.search.v1.search_connect import SearchService
from uwos.gen.search.v1.search_pb2 import (
    DeleteItemRequest,
    DeleteItemResponse,
    IndexItemRequest,
    IndexItemResponse,
    SearchRequest,
    SearchResponse,
    SearchResultItem,
    SearchResultType,
)
from uwos.models.search.search_index import SearchIndex
from uwos.models.shared import VisibilityScope

logger = logging.getLogger(__name__)


async def upsert_search_index(
    session: AsyncSession,
    urn: str,
    organization_id: UUID,
    title: str,
    entity_type: str,
    url_path: str,
    visibility: str,
    owner_id: UUID,
    description: str | None = None,
    keywords: str | None = None,
    shared_group_ids: list[UUID] | None = None,
    shared_user_ids: list[UUID] | None = None,
    rank_score: float = 1.0,
) -> None:
    """
    Upsert an item into the search index.

    This function is intended to be called by other services (Notes, Files, etc.)
    when content is created or updated.
    """
    stmt = insert(SearchIndex).values(
        urn=urn,
        organization_id=organization_id,
        title=title,
        description=description,
        keywords=keywords,
        entity_type=entity_type,
        url_path=url_path,
        visibility=visibility,
        owner_id=owner_id,
        shared_group_ids=shared_group_ids,
        shared_user_ids=shared_user_ids,
        updated_at=datetime.now(UTC),
        rank_score=rank_score,
    )

    # Do upsert
    stmt = stmt.on_conflict_do_update(
        index_elements=["urn"],
        set_={
            "title": stmt.excluded.title,
            "description": stmt.excluded.description,
            "keywords": stmt.excluded.keywords,
            "url_path": stmt.excluded.url_path,
            "visibility": stmt.excluded.visibility,
            "owner_id": stmt.excluded.owner_id,
            "shared_group_ids": stmt.excluded.shared_group_ids,
            "shared_user_ids": stmt.excluded.shared_user_ids,
            "updated_at": stmt.excluded.updated_at,
            "rank_score": stmt.excluded.rank_score,
        },
    )

    await session.execute(stmt)


class SearchServiceImpl(SearchService):
    """
    Implementation of the SearchService.

    Handles global search queries via the optimized search_index table.
    """

    async def search(self, request: SearchRequest, context: RequestContext) -> SearchResponse:
        """Perform a global search."""
        session: SQLModelAsyncSession
        async with get_async_session() as session:
            # TODO: Extract current user ID and group IDs from context (Auth interception)
            # For MVP/Mock, we might need a way to get this.
            # Assuming the auth middleware puts user info in context,
            # but usually in ConnectRPC python implementation we might need to look at headers.
            # For now, let's implement the query logic assuming we have the IDs.

            # FIXME: Placeholder for actual user context retrieval
            # This needs to be hooked up to the AuthContext when available
            # We'll rely on the Organization ID passed in the request for basic filtering
            # But true security requres the user_id.

            # Since we don't have the auth context fully wired in this snippet,
            # I will outline the query construction.

            query_term = request.query.strip()
            if not query_term:
                return SearchResponse(items=[])

            # Prepare Trigram Similarity Query
            # We filter by organization_id provided in the request (backend should validate this vs user token)

            # Basic filters
            filters = [SearchIndex.organization_id == UUID(request.organization_id)]

            if request.type_filters:
                # Map enum to string types if needed, or store logic.
                # Assuming simple string match for now based on SearchResultType names?
                # Actually we store 'note', 'file' in DB.
                # We need a mapper.
                valid_types = []
                for t in request.type_filters:
                    if t == SearchResultType.SEARCH_RESULT_TYPE_NOTE:
                        valid_types.append("note")
                    elif t == SearchResultType.SEARCH_RESULT_TYPE_FILE:
                        valid_types.append("file")
                    # ... add others

                if valid_types:
                    filters.append(SearchIndex.entity_type.in_(valid_types))

            # Fuzzy Search Filter
            # Using pg_trgm '%' operator (similarity) or ILIKE if term is short
            if len(query_term) < 3:
                # Fallback to ILIKE for short queries where trigrams are less effective
                filters.append(
                    or_(
                        SearchIndex.title.ilike(f"%{query_term}%"),
                        SearchIndex.keywords.ilike(f"%{query_term}%"),
                    )
                )
            else:
                # Use Trigram similarity
                # Note: 'keywords' column should be indexed with gin_trgm_ops
                # We search on title (boosted) or keywords
                # In SQLAlchemy, op('%') is the similarity operator
                filters.append(
                    or_(
                        SearchIndex.title.op("%")(query_term),
                        SearchIndex.keywords.op("%")(query_term),
                    )
                )

            # Permission Filter Construction (Placeholder variables)
            # current_user_id = ...
            # current_user_group_ids = ...

            # Access Control Logic (Commented out until we have user context)
            # acl_filter = or_(
            #    SearchIndex.visibility == VisibilityScope.ORGANIZATION.value,
            #    SearchIndex.owner_id == current_user_id,
            #    and_(
            #        SearchIndex.visibility == VisibilityScope.GROUP.value,
            #        SearchIndex.shared_group_ids.overlap(current_user_group_ids) # PG operator &&
            #    ),
            #    SearchIndex.shared_user_ids.contains([current_user_id]) # PG operator @>
            # )
            # filters.append(acl_filter)

            stmt = (
                select(SearchIndex)
                .where(*filters)
                .order_by(
                    # Order by similarity score descending
                    desc(func.similarity(SearchIndex.title, query_term)),
                    desc(SearchIndex.updated_at),
                )
                .limit(request.limit or 20)
            )

            result = await session.execute(stmt)
            rows = result.scalars().all()

            response_items = []
            for row in rows:
                # Map string type back to Enum
                res_type = SearchResultType.SEARCH_RESULT_TYPE_UNSPECIFIED
                if row.entity_type == "note":
                    res_type = SearchResultType.SEARCH_RESULT_TYPE_NOTE
                elif row.entity_type == "file":
                    res_type = SearchResultType.SEARCH_RESULT_TYPE_FILE

                response_items.append(
                    SearchResultItem(
                        urn=row.urn,
                        title=row.title,
                        description=row.description or "",
                        type=res_type,
                        url=row.url_path,
                        score=row.rank_score,  # We might want to pass actual similarity here
                        metadata={},
                    )
                )

            return SearchResponse(items=response_items)

    async def index_item(
        self, request: IndexItemRequest, context: RequestContext
    ) -> IndexItemResponse:
        """
        Internal RPC to index an item.
        Or could be used by external trusted workers.
        """
        async with get_async_session() as session:
            # Map request to internal upsert
            await upsert_search_index(
                session=session,
                urn=request.urn,  # We should ensure request has urn or construct it
                organization_id=UUID(request.organization_id),
                title=request.title,
                entity_type="note",  # FIXME: Need generic type mapper from request
                url_path=request.url,
                # We need visibility in request? Or fetch it?
                # For `IndexItemRequest` in proto, we only defined a few fields.
                # We might need to expand IndexItemRequest to carry permission info
                # OR this RPC is just a naive "update text" and we assume permissions don't change often?
                # Actually, the python function `upsert_search_index` is the robust one.
                # This RPC might be for simple external indexing.
                visibility=VisibilityScope.PRIVATE.value,  # Default safe
                owner_id=UUID("00000000-0000-0000-0000-000000000000"),  # generic
                description=request.content[:200] if request.content else None,
                keywords=f"{request.title} {request.content or ''}",
            )
            await session.commit()

        return IndexItemResponse(success=True)

    async def delete_item(
        self, request: DeleteItemRequest, context: RequestContext
    ) -> DeleteItemResponse:
        """Remove item from index."""
        async with get_async_session() as session:
            stmt = delete(SearchIndex).where(SearchIndex.urn == request.urn)
            await session.execute(stmt)
            await session.commit()

        return DeleteItemResponse(success=True)
