"""
Meilisearch client wrapper for unified search.

Provides an async client for indexing and searching content in Meilisearch.
Uses meilisearch-python-sdk for async support with FastAPI/asyncio.
"""

import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from meilisearch_python_sdk import AsyncClient
from meilisearch_python_sdk.models.search import SearchResults
from meilisearch_python_sdk.models.settings import (
    Faceting,
    MeilisearchSettings,
    MinWordSizeForTypos,
    Pagination,
    TypoTolerance,
)

from uniffy.observability.metrics import (
    SEARCH_OPERATION_DURATION,
    SEARCH_OPERATION_ERRORS_TOTAL,
    SEARCH_OPERATIONS_TOTAL,
)

# Index name for all Uniffy content
UNIFFY_INDEX_NAME = "uniffy"


@dataclass
class MeilisearchConfig:
    """Meilisearch connection configuration."""

    url: str
    master_key: str
    index_name: str = UNIFFY_INDEX_NAME

    @classmethod
    def from_env(cls) -> MeilisearchConfig:
        """
        Create config from environment variables.

        Environment Variables
        ---------------------
        MEILISEARCH_URL : str
            Meilisearch server URL (default: http://localhost:7700)
        MEILISEARCH_MASTER_KEY : str
            Master API key for authentication (default: uniffy-dev-master-key)
        MEILISEARCH_INDEX_NAME : str
            Index name (default: uniffy)

        """
        return cls(
            url=os.getenv("MEILISEARCH_URL", "http://localhost:7700"),
            master_key=os.getenv("MEILISEARCH_MASTER_KEY", "uniffy-dev-master-key"),
            index_name=os.getenv("MEILISEARCH_INDEX_NAME", UNIFFY_INDEX_NAME),
        )


# Index settings for optimal search experience
INDEX_SETTINGS = MeilisearchSettings(
    # Fields to search in, ordered by importance
    searchable_attributes=[
        "title",  # Highest priority
        "content",  # Full text content
        "tags",  # Tags
        "description",  # Preview snippet
    ],
    # Fields available for filtering
    filterable_attributes=[
        "urn",  # For batch URN lookups (mention previews)
        "organization_id",
        "entity_type",
        "visibility",
        "owner_id",
        "shared_group_ids",
        "shared_user_ids",
        "tags",
    ],
    # Fields available for sorting
    sortable_attributes=[
        "updated_at",
        "rank_score",
        "title",
    ],
    # Ranking rules (Meilisearch default order is good)
    ranking_rules=[
        "words",  # Number of matching words
        "typo",  # Fewer typos = better
        "proximity",  # Words closer together = better
        "attribute",  # Match in title > content > tags
        "sort",  # Custom sorting
        "exactness",  # Exact matches > prefix matches
    ],
    # Typo tolerance settings
    typo_tolerance=TypoTolerance(
        enabled=True,
        min_word_size_for_typos=MinWordSizeForTypos(
            one_typo=4,  # Allow 1 typo for words >= 4 chars
            two_typos=8,  # Allow 2 typos for words >= 8 chars
        ),
    ),
    # Faceting for aggregations
    faceting=Faceting(max_values_per_facet=100),
    # Pagination limits
    pagination=Pagination(max_total_hits=1000),
)


def build_document_id(urn: str, organization_id: UUID) -> str:
    """
    Build a Meilisearch document ID from URN and organization.

    Meilisearch requires a single string primary key, so we combine
    URN and organization_id with a delimiter. Colons in URNs are replaced
    with hyphens since Meilisearch only allows alphanumeric, hyphens, and
    underscores in document IDs.

    Parameters
    ----------
    urn : str
        Universal Resource Name (e.g., urn:uniffy:content:NOTE:uuid).
    organization_id : UUID
        Organization ID.

    Returns
    -------
    str
        Document ID in format `{urn_with_hyphens}__{organization_id}`

    """
    # Replace colons with hyphens for Meilisearch compatibility
    safe_urn = urn.replace(":", "-")
    return f"{safe_urn}__{organization_id}"


def parse_document_id(doc_id: str) -> tuple[str, str]:
    """
    Parse a Meilisearch document ID back to URN and organization_id.

    Reverses the transformation done by build_document_id, converting
    hyphens back to colons in the URN prefix.

    Parameters
    ----------
    doc_id : str
        Document ID in format `{safe_urn}__{organization_id}`

    Returns
    -------
    tuple[str, str]
        (urn, organization_id)

    """
    parts = doc_id.rsplit("__", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid document ID format: {doc_id}")
    safe_urn, org_id = parts
    # Restore colons in the URN prefix (urn-uniffy-content-TYPE -> urn:uniffy:content:TYPE)
    # Only restore the first 4 hyphens which correspond to the URN structure
    urn = safe_urn.replace("urn-uniffy-content-", "urn:uniffy:content:", 1)
    return urn, org_id


class MeilisearchClient:
    """
    Async Meilisearch client wrapper for Uniffy search.

    Provides high-level methods for indexing and searching content
    with multi-tenancy support via organization_id filtering.

    Parameters
    ----------
    config : MeilisearchConfig
        Connection configuration.

    Example
    -------
    ```python
    config = MeilisearchConfig.from_env()
    async with MeilisearchClient(config) as client:
        await client.index_document(...)
        results = await client.search(...)
    ```

    """

    def __init__(self, config: MeilisearchConfig | None = None) -> None:
        """Initialize the Meilisearch client."""
        self.config = config or MeilisearchConfig.from_env()
        self._client: AsyncClient | None = None

    async def __aenter__(self) -> MeilisearchClient:
        """Async context manager entry."""
        self._client = AsyncClient(self.config.url, self.config.master_key)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        if self._client:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> AsyncClient:
        """Get the underlying async client."""
        if self._client is None:
            raise RuntimeError(
                "MeilisearchClient not initialized. Use 'async with' context manager."
            )
        return self._client

    async def ensure_index(self) -> None:
        """
        Ensure the Uniffy index exists with correct settings.

        Creates the index if it doesn't exist and updates settings.
        Should be called on application startup.

        """
        start = time.perf_counter()
        # Try to get existing index
        try:
            index = await self.client.get_index(self.config.index_name)
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: get_index '{self.config.index_name}' (exists)",
                ms=f"{elapsed_ms:.1f}",
            )
        except Exception:
            # Index doesn't exist, create it with settings
            index = await self.client.create_index(
                self.config.index_name,
                primary_key="id",
                settings=INDEX_SETTINGS,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: create_index '{self.config.index_name}'",
                ms=f"{elapsed_ms:.1f}",
            )
            return  # Settings already applied during creation

        # Update settings on existing index
        settings_start = time.perf_counter()
        await index.update_settings(INDEX_SETTINGS)
        elapsed_ms = (time.perf_counter() - settings_start) * 1000
        logger.info(
            f"Meilisearch: update_settings '{self.config.index_name}'",
            ms=f"{elapsed_ms:.1f}",
        )

    async def index_document(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        visibility: str,
        owner_id: UUID,
        content: str | None = None,
        description: str | None = None,
        shared_group_ids: list[UUID] | None = None,
        shared_user_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float = 1.0,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """
        Index or update a document in Meilisearch.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID for multi-tenancy.
        title : str
            Document title (primary search field).
        entity_type : str
            Type of content ('note', 'file', 'user', etc).
        url_path : str
            Frontend route to navigate to.
        visibility : str
            Visibility scope ('PRIVATE', 'GROUP', 'ORGANIZATION').
        owner_id : UUID
            Owner of the content.
        content : str | None
            Full searchable content.
        description : str | None
            Short preview snippet.
        shared_group_ids : list[UUID] | None
            Groups this content is shared with.
        shared_user_ids : list[UUID] | None
            Users this content is shared with.
        tags : list[str] | None
            Content tags.
        rank_score : float
            Relevance booster (default 1.0).
        metadata : dict[str, str] | None
            Extra key-value metadata (e.g. mime_type, start_time).

        """
        doc_id = build_document_id(urn, organization_id)

        document = {
            "id": doc_id,
            "urn": urn,
            "organization_id": str(organization_id),
            "title": title,
            "content": content or "",
            "description": description or "",
            "entity_type": entity_type,
            "url_path": url_path,
            "visibility": visibility,
            "owner_id": str(owner_id),
            "shared_group_ids": [str(gid) for gid in (shared_group_ids or [])],
            "shared_user_ids": [str(uid) for uid in (shared_user_ids or [])],
            "tags": tags or [],
            "rank_score": rank_score,
            "metadata": metadata or {},
            "updated_at": int(datetime.now(UTC).timestamp()),
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.add_documents([document])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="index").inc()
        SEARCH_OPERATION_DURATION.labels(operation="index").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: index_document type={entity_type}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def delete_document(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        """
        Delete a document from Meilisearch.

        Parameters
        ----------
        urn : str
            Universal Resource Name to delete.
        organization_id : UUID | None
            If provided, only delete for this organization.
            If None, deletes all entries for this URN across all orgs.

        """
        start = time.perf_counter()
        index = self.client.index(self.config.index_name)

        if organization_id:
            # Delete specific document
            doc_id = build_document_id(urn, organization_id)
            await index.delete_document(doc_id)
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="delete").inc()
            SEARCH_OPERATION_DURATION.labels(operation="delete").observe(elapsed_ms / 1000)
            logger.info(
                "Meilisearch: delete_document",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
        else:
            # Delete all documents with this URN across all orgs
            # Use filter-based deletion
            await index.delete_documents_by_filter(f'urn = "{urn}"')
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="delete").inc()
            SEARCH_OPERATION_DURATION.labels(operation="delete").observe(elapsed_ms / 1000)
            logger.info(
                "Meilisearch: delete_documents_by_filter",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )

    async def search(
        self,
        query: str,
        organization_id: UUID,
        user_id: UUID,
        user_group_ids: list[UUID] | None = None,
        type_filters: list[str] | None = None,
        tag_filters: list[str] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> SearchResults:
        """
        Search for documents with permission filtering.

        Parameters
        ----------
        query : str
            Search query text.
        organization_id : UUID
            Organization to search within.
        user_id : UUID
            User performing the search (for permission filtering).
        user_group_ids : list[UUID] | None
            Groups the user belongs to.
        type_filters : list[str] | None
            Filter by entity types (e.g., ['note', 'file']).
        tag_filters : list[str] | None
            Filter by tags.
        my_content_only : bool
            Only return content owned by the user.
        owner_filter : UUID | None
            Filter by specific owner.
        limit : int
            Maximum results to return.
        offset : int
            Offset for pagination.

        Returns
        -------
        SearchResults
            Meilisearch search results.

        """
        index = self.client.index(self.config.index_name)

        # Build filter expression
        filters = self._build_permission_filter(
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
            my_content_only=my_content_only,
            owner_filter=owner_filter,
        )

        # Add type filters
        if type_filters:
            type_filter = " OR ".join(f'entity_type = "{t}"' for t in type_filters)
            filters = f"({filters}) AND ({type_filter})"

        # Add tag filters (AND - all tags must match)
        if tag_filters:
            tag_conditions = " AND ".join(f'tags = "{tag}"' for tag in tag_filters)
            filters = f"({filters}) AND ({tag_conditions})"

        # Execute search
        start = time.perf_counter()
        results = await index.search(
            query=query if query else None,
            filter=filters,
            limit=limit,
            offset=offset,
            sort=["rank_score:desc", "updated_at:desc"] if not query else None,
            show_ranking_score=True,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="search").inc()
        SEARCH_OPERATION_DURATION.labels(operation="search").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: search hits={len(results.hits)}",
            ms=f"{elapsed_ms:.1f}",
            query=query[:50] if query else "",
        )

        return results

    def _build_permission_filter(
        self,
        organization_id: UUID,
        user_id: UUID,
        user_group_ids: list[UUID] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
    ) -> str:
        """
        Build Meilisearch filter for permission checking.

        User can see content if:
        1. Visibility is ORGANIZATION (all org members can see)
        2. They own it
        3. Visibility is GROUP and they're in a shared group
        4. They're explicitly in shared_user_ids

        Parameters
        ----------
        organization_id : UUID
            Organization to filter by.
        user_id : UUID
            User performing the search.
        user_group_ids : list[UUID] | None
            Groups the user belongs to.
        my_content_only : bool
            Only return user's own content.
        owner_filter : UUID | None
            Filter by specific owner.

        Returns
        -------
        str
            Meilisearch filter expression.

        """
        org_filter = f'organization_id = "{organization_id}"'

        if my_content_only:
            return f'{org_filter} AND owner_id = "{user_id}"'

        if owner_filter:
            return f'{org_filter} AND owner_id = "{owner_filter}"'

        # Build permission conditions
        permission_conditions = [
            # ORGANIZATION visibility - everyone in org can see
            'visibility = "ORGANIZATION"',
            # Owner can always see their content
            f'owner_id = "{user_id}"',
            # Explicitly shared with user
            f'shared_user_ids = "{user_id}"',
        ]

        # GROUP visibility - user must be in a shared group
        if user_group_ids:
            group_conditions = " OR ".join(f'shared_group_ids = "{gid}"' for gid in user_group_ids)
            permission_conditions.append(f'(visibility = "GROUP" AND ({group_conditions}))')

        permission_filter = " OR ".join(permission_conditions)
        return f"{org_filter} AND ({permission_filter})"

    async def update_document_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
    ) -> None:
        """
        Partial update of sharing metadata on an existing document.

        Uses Meilisearch's update_documents which merges fields into
        the existing document without replacing other fields.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID.
        shared_user_ids : list[UUID]
            Current list of user IDs this content is shared with.
        shared_group_ids : list[UUID]
            Current list of group IDs this content is shared with.

        """
        doc_id = build_document_id(urn, organization_id)
        partial = {
            "id": doc_id,
            "shared_user_ids": [str(uid) for uid in shared_user_ids],
            "shared_group_ids": [str(gid) for gid in shared_group_ids],
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_sharing").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_sharing").observe(elapsed_ms / 1000)
        logger.info(
            "Meilisearch: update_sharing "
            f"users={len(shared_user_ids)} groups={len(shared_group_ids)}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def get_document(self, urn: str, organization_id: UUID) -> dict[str, Any] | None:
        """
        Get a single document by URN and organization.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        dict | None
            Document if found, None otherwise.

        """
        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        doc_id = build_document_id(urn, organization_id)

        try:
            result = await index.get_document(doc_id)
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get").observe(elapsed_ms / 1000)
            logger.info(
                f"Meilisearch: get_document found={result is not None}",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
            return result
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get").observe(elapsed_ms / 1000)
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="get").inc()
            logger.info(
                "Meilisearch: get_document found=False",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
            return None

    async def get_documents_by_urns(
        self,
        urns: list[str],
        organization_id: UUID,
    ) -> dict[str, dict[str, Any]]:
        """
        Get multiple documents by URNs.

        Uses filter-based lookup since Meilisearch doesn't support
        fetching multiple documents by ID directly.

        Parameters
        ----------
        urns : list[str]
            List of URNs to fetch.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        dict[str, dict]
            Mapping of URN to document.

        """
        if not urns:
            return {}

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)

        # Build filter to match any of the URNs within the organization
        # URN is stored as a field in the document
        urn_filters = " OR ".join(f'urn = "{urn}"' for urn in urns)
        org_filter = f'organization_id = "{organization_id}"'
        combined_filter = f"({urn_filters}) AND {org_filter}"

        try:
            # Use get_documents with filter parameter (requires Meilisearch >= 1.2.0)
            docs = await index.get_documents(
                filter=combined_filter,
                limit=len(urns),
            )
            result = {doc["urn"]: doc for doc in docs.results if "urn" in doc}
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get_batch").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get_batch").observe(elapsed_ms / 1000)
            logger.info(
                f"Meilisearch: get_documents_by_urns found={len(result)}/{len(urns)}",
                ms=f"{elapsed_ms:.1f}",
            )
            return result
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get_batch").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get_batch").observe(elapsed_ms / 1000)
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="get_batch").inc()
            logger.warning(
                f"Meilisearch: get_documents_by_urns failed: {e}",
                ms=f"{elapsed_ms:.1f}",
            )
            return {}

    async def health_check(self) -> bool:
        """
        Check if Meilisearch is healthy.

        Returns
        -------
        bool
            True if healthy, False otherwise.

        """
        start = time.perf_counter()
        try:
            health = await self.client.health()
            is_healthy = health.status == "available"
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: health_check status={health.status}",
                ms=f"{elapsed_ms:.1f}",
            )
            return is_healthy
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="health_check").inc()
            logger.warning(
                f"Meilisearch: health_check failed: {e}",
                ms=f"{elapsed_ms:.1f}",
            )
            return False


# Global client instance (initialized on app startup)
_meilisearch_client: MeilisearchClient | None = None


async def init_meilisearch() -> MeilisearchClient:
    """
    Initialize the global Meilisearch client.

    Should be called during application startup.

    Returns
    -------
    MeilisearchClient
        Initialized client.

    """
    global _meilisearch_client

    config = MeilisearchConfig.from_env()
    _meilisearch_client = MeilisearchClient(config)
    _meilisearch_client._client = AsyncClient(config.url, config.master_key)

    # Ensure index exists with correct settings
    await _meilisearch_client.ensure_index()

    logger.info(f"Meilisearch client initialized: {config.url}")
    return _meilisearch_client


async def close_meilisearch() -> None:
    """
    Close the global Meilisearch client.

    Should be called during application shutdown.

    """
    global _meilisearch_client

    if _meilisearch_client and _meilisearch_client._client:
        await _meilisearch_client._client.aclose()
        _meilisearch_client = None
        logger.info("Meilisearch client closed")


def get_meilisearch_client() -> MeilisearchClient:
    """
    Get the global Meilisearch client.

    Returns
    -------
    MeilisearchClient
        The initialized client.

    Raises
    ------
    RuntimeError
        If client not initialized.

    """
    if _meilisearch_client is None:
        raise RuntimeError("Meilisearch client not initialized. Call init_meilisearch() first.")
    return _meilisearch_client
