"""
Search query utilities using Meilisearch.

This module provides search execution via Meilisearch with:
1. Typo-tolerant fuzzy matching
2. Permission filtering based on visibility
3. Type and tag filtering
"""

import contextlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from uniffy.core.search import get_meilisearch_client


@dataclass
class SearchResult:
    """
    Search result from Meilisearch.

    Lightweight dataclass representing a search hit with all
    necessary fields for display and navigation.
    """

    urn: str
    organization_id: UUID
    title: str
    description: str | None
    entity_type: str
    url_path: str
    visibility: str
    owner_id: UUID
    tags: list[str] | None
    metadata: dict[str, str] | None
    updated_at: datetime | None
    rank_score: float
    search_score: float | None  # Meilisearch ranking score

    # Live state fields for mention enrichment
    status: str | None = None
    due_date: str | None = None
    assignee_name: str | None = None
    processing_status: str | None = None
    completed_tasks: int = 0
    total_tasks: int = 0
    member_count: int = 0
    updated_by_name: str | None = None

    @classmethod
    def from_meilisearch_hit(cls, hit: dict[str, Any]) -> SearchResult:
        """
        Create SearchResult from Meilisearch hit document.

        Parameters
        ----------
        hit : dict
            Meilisearch search hit.

        Returns
        -------
        SearchResult
            Parsed search result.

        """
        # Parse updated_at from timestamp if present
        updated_at = None
        if hit.get("updated_at"):
            with contextlib.suppress(ValueError, TypeError):
                updated_at = datetime.fromtimestamp(hit["updated_at"])

        return cls(
            urn=hit.get("urn", ""),
            organization_id=UUID(hit["organization_id"]),
            title=hit.get("title", ""),
            description=hit.get("description"),
            entity_type=hit.get("entity_type", ""),
            url_path=hit.get("url_path", ""),
            visibility=hit.get("visibility", "PRIVATE"),
            owner_id=UUID(hit["owner_id"]),
            tags=hit.get("tags"),
            metadata=hit.get("metadata"),
            updated_at=updated_at,
            rank_score=hit.get("rank_score", 1.0),
            search_score=hit.get("_rankingScore"),
        )


async def execute_search(
    query_text: str,
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: list[UUID],
    type_filters: list[str] | None = None,
    tag_filters: list[str] | None = None,
    my_content_only: bool = False,
    owner_filter: UUID | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[SearchResult], int]:
    """
    Execute a fuzzy search via Meilisearch.

    Parameters
    ----------
    query_text : str
        The search query string.
    organization_id : UUID
        Organization ID for tenant isolation.
    user_id : UUID
        User performing the search.
    user_group_ids : list[UUID]
        Group IDs the user belongs to.
    type_filters : list[str] | None
        Optional entity types to filter by (e.g., ['note', 'file']).
    tag_filters : list[str] | None
        Optional tag filters.
    my_content_only : bool
        If True, only return content owned by the user.
    owner_filter : UUID | None
        Filter by specific owner ID.
    limit : int
        Maximum number of results.
    offset : int
        Offset for pagination.

    Returns
    -------
    tuple[list[SearchResult], int]
        List of search results and estimated total hits.

    """
    client = get_meilisearch_client()

    results = await client.search(
        query=query_text,
        organization_id=organization_id,
        user_id=user_id,
        user_group_ids=user_group_ids,
        type_filters=type_filters,
        tag_filters=tag_filters,
        my_content_only=my_content_only,
        owner_filter=owner_filter,
        limit=limit,
        offset=offset,
    )

    # Convert hits to SearchResult objects
    search_results = [SearchResult.from_meilisearch_hit(hit) for hit in results.hits]

    return search_results, results.estimated_total_hits or len(search_results)


async def get_documents_by_urns(
    urns: list[str],
    organization_id: UUID,
    user_id: UUID | None = None,
    user_group_ids: list[UUID] | None = None,
) -> dict[str, SearchResult]:
    """
    Fetch documents by URNs from Meilisearch with optional permission filtering.

    When user_id is provided, uses Meilisearch search with permission filters
    instead of raw get_documents, so only accessible documents are returned.

    Parameters
    ----------
    urns : list[str]
        List of URNs to fetch.
    organization_id : UUID
        Organization ID.
    user_id : UUID | None
        If provided, filter results by this user's permissions.
    user_group_ids : list[UUID] | None
        Groups the user belongs to (for GROUP visibility).

    Returns
    -------
    dict[str, SearchResult]
        Mapping of URN to SearchResult (only accessible items).

    """
    if not urns:
        return {}

    client = get_meilisearch_client()

    if user_id is not None:
        # Use get_documents with permission filtering + URN filter
        # Chunk URNs to avoid filter expression limits (max ~50 per query)
        all_results: dict[str, SearchResult] = {}
        chunk_size = 50
        perm_filter = client._build_permission_filter(
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
        )
        index = client.client.index(client.config.index_name)

        for i in range(0, len(urns), chunk_size):
            chunk = urns[i : i + chunk_size]
            urn_filter = " OR ".join(f'urn = "{urn}"' for urn in chunk)
            combined_filter = f"({urn_filter}) AND ({perm_filter})"

            try:
                docs = await index.get_documents(
                    filter=combined_filter,
                    limit=len(chunk),
                )
                for doc in docs.results:
                    if "urn" in doc:
                        all_results[doc["urn"]] = SearchResult.from_meilisearch_hit(doc)
            except Exception:
                pass

        return all_results

    # No permission filtering - raw fetch
    docs = await client.get_documents_by_urns(urns, organization_id)
    return {urn: SearchResult.from_meilisearch_hit(doc) for urn, doc in docs.items()}
