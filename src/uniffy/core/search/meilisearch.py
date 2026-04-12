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
    timeout: int = 30

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
        MEILISEARCH_TIMEOUT : int
            HTTP request timeout in seconds (default: 30)

        """
        return cls(
            url=os.getenv("MEILISEARCH_URL", "http://localhost:7700"),
            master_key=os.getenv("MEILISEARCH_MASTER_KEY", "uniffy-dev-master-key"),
            index_name=os.getenv("MEILISEARCH_INDEX_NAME", UNIFFY_INDEX_NAME),
            timeout=int(os.getenv("MEILISEARCH_TIMEOUT", "30")),
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
        "access_mode",
        "baseline_role",
        "owner_id",
        "shared_user_ids",
        "shared_group_ids",
        "blocked_user_ids",
        "blocked_group_ids",
        "tags",
        "updated_at",  # Time-bounded searches (e.g., "modified this week")
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
        self._client = AsyncClient(
            self.config.url,
            self.config.master_key,
            timeout=self.config.timeout,
        )
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
        owner_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        content: str | None = None,
        description: str | None = None,
        shared_user_ids: list[UUID] | None = None,
        shared_group_ids: list[UUID] | None = None,
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float = 1.0,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Index or update a document in Meilisearch.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID for multi-tenancy.
        title : str
            Document title (primary search field).
        entity_type : str
            Type of content (``note``, ``file``, ``project``, ...).
        url_path : str
            Frontend route to navigate to.
        owner_id : UUID
            Owner of the content.
        access_mode : str
            Access mode (``OWNER_ONLY`` / ``EXPLICIT_MEMBERS`` /
            ``OPEN_TO_ORG``).
        baseline_role : str | None
            Baseline role for OPEN_TO_ORG, otherwise None.
        content : str | None
            Full searchable content.
        description : str | None
            Short preview snippet.
        shared_user_ids : list[UUID] | None
            User subjects with a non-BLOCKED ContentMember row.
        shared_group_ids : list[UUID] | None
            Group subjects with a non-BLOCKED ContentMember row.
        blocked_user_ids : list[UUID] | None
            User subjects with a BLOCKED ContentMember row.
        blocked_group_ids : list[UUID] | None
            Group subjects with a BLOCKED ContentMember row.
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
            "access_mode": access_mode,
            "baseline_role": baseline_role,
            "owner_id": str(owner_id),
            "shared_user_ids": [str(uid) for uid in (shared_user_ids or [])],
            "shared_group_ids": [str(gid) for gid in (shared_group_ids or [])],
            "blocked_user_ids": [str(uid) for uid in (blocked_user_ids or [])],
            "blocked_group_ids": [str(gid) for gid in (blocked_group_ids or [])],
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

    async def batch_index_documents(
        self,
        documents: list[dict[str, Any]],
    ) -> None:
        """
        Index multiple documents in a single Meilisearch call.

        Each document dict must contain all required fields (id, urn,
        organization_id, title, entity_type, etc.). Use build_document_id()
        to generate the id field.

        Parameters
        ----------
        documents : list[dict]
            List of document dicts ready for Meilisearch.

        """
        if not documents:
            return

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.add_documents(documents)
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="index").inc(len(documents))
        SEARCH_OPERATION_DURATION.labels(operation="index").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: batch_index count={len(documents)}",
            ms=f"{elapsed_ms:.1f}",
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
        exclude_type_filters: list[str] | None = None,
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

        # Add type exclusion filters
        if exclude_type_filters:
            exclude_filter = " AND ".join(
                f'entity_type != "{t}"' for t in exclude_type_filters
            )
            filters = f"({filters}) AND ({exclude_filter})"

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
        """Build a Meilisearch filter that mirrors ``effective_role``.

        A user sees a document iff:

        - it belongs to their organization, AND
        - they are NOT in ``blocked_user_ids``, AND
        - NONE of their groups are in ``blocked_group_ids``, AND
        - at least one of the following is true:
          - they are the owner,
          - their id is in ``shared_user_ids``,
          - one of their groups is in ``shared_group_ids``,
          - the document has ``access_mode = OPEN_TO_ORG`` with a
            non-null ``baseline_role``.

        ``my_content_only`` and ``owner_filter`` short-circuit the
        permission branch to just an ownership check.
        """
        org_filter = f'organization_id = "{organization_id}"'

        if my_content_only:
            return f'{org_filter} AND owner_id = "{user_id}"'

        if owner_filter:
            return f'{org_filter} AND owner_id = "{owner_filter}"'

        # Permission conditions (allow when any of these is true)
        permission_conditions = [
            f'owner_id = "{user_id}"',
            f'shared_user_ids = "{user_id}"',
            '(access_mode = "OPEN_TO_ORG" AND baseline_role EXISTS)',
        ]
        if user_group_ids:
            group_allow = " OR ".join(
                f'shared_group_ids = "{gid}"' for gid in user_group_ids
            )
            permission_conditions.append(f"({group_allow})")
        permission_filter = " OR ".join(permission_conditions)

        # Block conditions (deny when any of these is true)
        block_conditions = [f'NOT blocked_user_ids = "{user_id}"']
        if user_group_ids:
            block_conditions.extend(
                f'NOT blocked_group_ids = "{gid}"' for gid in user_group_ids
            )
        block_filter = " AND ".join(block_conditions)

        return f"{org_filter} AND ({block_filter}) AND ({permission_filter})"

    async def update_document_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
    ) -> None:
        """Partial update of membership metadata on an existing document.

        Uses Meilisearch's update_documents which merges fields into the
        existing document without replacing other fields.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID.
        shared_user_ids : list[UUID]
            Current list of user subjects with a non-BLOCKED grant.
        shared_group_ids : list[UUID]
            Current list of group subjects with a non-BLOCKED grant.
        blocked_user_ids : list[UUID] | None
            Current list of user subjects with a BLOCKED grant.
        blocked_group_ids : list[UUID] | None
            Current list of group subjects with a BLOCKED grant.

        """
        doc_id = build_document_id(urn, organization_id)
        partial = {
            "id": doc_id,
            "shared_user_ids": [str(uid) for uid in shared_user_ids],
            "shared_group_ids": [str(gid) for gid in shared_group_ids],
            "blocked_user_ids": [str(uid) for uid in (blocked_user_ids or [])],
            "blocked_group_ids": [str(gid) for gid in (blocked_group_ids or [])],
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_sharing").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_sharing").observe(elapsed_ms / 1000)
        logger.info(
            "Meilisearch: update_sharing "
            f"users={len(shared_user_ids)} groups={len(shared_group_ids)} "
            f"blocked_users={len(blocked_user_ids or [])} "
            f"blocked_groups={len(blocked_group_ids or [])}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def update_document_access_policy(
        self,
        urn: str,
        organization_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        owner_id: UUID,
    ) -> None:
        """Partial update of the access policy fields on a document."""
        doc_id = build_document_id(urn, organization_id)
        partial = {
            "id": doc_id,
            "access_mode": access_mode,
            "baseline_role": baseline_role,
            "owner_id": str(owner_id),
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_access_policy").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_access_policy").observe(
            elapsed_ms / 1000
        )
        logger.info(
            f"Meilisearch: update_access_policy mode={access_mode} baseline={baseline_role}",
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
        org_filter = f'organization_id = "{organization_id}"'

        # Chunk URNs to avoid filter expression complexity limits
        result: dict[str, dict[str, Any]] = {}
        chunk_size = 50

        try:
            for i in range(0, len(urns), chunk_size):
                chunk = urns[i : i + chunk_size]
                urn_filters = " OR ".join(f'urn = "{urn}"' for urn in chunk)
                combined_filter = f"({urn_filters}) AND {org_filter}"

                docs = await index.get_documents(
                    filter=combined_filter,
                    limit=len(chunk),
                )
                for doc in docs.results:
                    if "urn" in doc:
                        result[doc["urn"]] = doc

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
    _meilisearch_client._client = AsyncClient(
        config.url,
        config.master_key,
        timeout=config.timeout,
    )

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
