"""
Search indexing utilities.

Provides the SearchIndexer class for adding, updating, and removing
content from the unified search index using Meilisearch.
"""

from uuid import UUID

from uniffy.core.types import ContentType


class SearchIndexer:
    """
    Utility for indexing content in unified search.

    Provides methods to add, update, and remove content from
    the Meilisearch index with proper permission denormalization.

    Note: This class no longer requires a database session since
    indexing is done via Meilisearch HTTP API, not PostgreSQL.

    """

    def __init__(self, session=None) -> None:
        """
        Initialize the search indexer.

        Parameters
        ----------
        session : AsyncSession | None
            Database session (kept for backwards compatibility, not used).

        """
        # Session kept for backwards compatibility but not used
        self._session = session

    async def index(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        visibility: str,
        owner_id: UUID,
        keywords: str | None = None,
        description: str | None = None,
        shared_group_ids: list[UUID] | None = None,
        shared_user_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float = 1.0,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """
        Index or update content in the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name. Format: `urn:uniffy:content:<type>:<id>`
        organization_id : UUID
            Organization ID for tenant isolation.
        title : str
            Main display title and primary search target.
        entity_type : str
            Type of content ('note', 'file', 'book', etc).
        url_path : str
            Frontend route to navigate to.
        visibility : str
            Visibility scope ('PRIVATE', 'GROUP', 'ORGANIZATION', 'PUBLIC').
        owner_id : UUID
            Owner of the content.
        keywords : str | None
            Aggregated text for indexing (mapped to 'content' in Meilisearch).
        description : str | None
            Subtitle or short snippet for context.
        shared_group_ids : list[UUID] | None
            List of Group IDs this content is shared with.
        shared_user_ids : list[UUID] | None
            List of User IDs this content is explicitly shared with.
        tags : list[str] | None
            Tags associated with the content.
        rank_score : float
            Relevance booster (default 1.0).
        metadata : dict[str, str] | None
            Extra key-value metadata (e.g. mime_type, start_time).

        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.index_document(
            urn=urn,
            organization_id=organization_id,
            title=title,
            entity_type=entity_type,
            url_path=url_path,
            visibility=visibility,
            owner_id=owner_id,
            content=keywords,  # 'keywords' maps to 'content' in Meilisearch
            description=description,
            shared_group_ids=shared_group_ids,
            shared_user_ids=shared_user_ids,
            tags=tags,
            rank_score=rank_score,
            metadata=metadata,
        )

    async def batch_index(
        self,
        items: list[dict],
    ) -> None:
        """
        Batch-index multiple documents in a single Meilisearch call.

        Each item must be a dict with keys: urn, organization_id, title,
        entity_type, url_path, visibility, owner_id, and optionally
        keywords, description, shared_group_ids, shared_user_ids, tags,
        rank_score, metadata.

        Parameters
        ----------
        items : list[dict]
            List of document dicts to index.

        """
        if not items:
            return

        from uniffy.core.search.meilisearch import build_document_id, get_meilisearch_client

        documents = []
        for item in items:
            org_id = item["organization_id"]
            urn = item["urn"]
            from datetime import UTC, datetime

            documents.append({
                "id": build_document_id(urn, org_id),
                "urn": urn,
                "organization_id": str(org_id),
                "title": item.get("title", ""),
                "content": item.get("keywords", ""),
                "description": item.get("description", ""),
                "entity_type": item.get("entity_type", ""),
                "url_path": item.get("url_path", ""),
                "visibility": item.get("visibility", "PRIVATE"),
                "owner_id": str(item.get("owner_id", "")),
                "shared_group_ids": [str(gid) for gid in (item.get("shared_group_ids") or [])],
                "shared_user_ids": [str(uid) for uid in (item.get("shared_user_ids") or [])],
                "tags": item.get("tags") or [],
                "rank_score": item.get("rank_score", 1.0),
                "metadata": item.get("metadata") or {},
                "updated_at": int(datetime.now(UTC).timestamp()),
            })

        client = get_meilisearch_client()
        await client.batch_index_documents(documents)

    async def update_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
    ) -> None:
        """
        Partial update of sharing metadata in the search index.

        Only updates shared_user_ids and shared_group_ids without
        touching any other fields in the document.

        Parameters
        ----------
        urn : str
            Universal Resource Name.
        organization_id : UUID
            Organization ID.
        shared_user_ids : list[UUID]
            Current list of user IDs with explicit access.
        shared_group_ids : list[UUID]
            Current list of group IDs with access.

        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_sharing(
            urn=urn,
            organization_id=organization_id,
            shared_user_ids=shared_user_ids,
            shared_group_ids=shared_group_ids,
        )

    async def remove(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        """
        Remove content from the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name to remove.
        organization_id : UUID | None
            If provided, only remove for this organization.
            If None, removes all entries for this URN across all orgs.

        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.delete_document(urn, organization_id)

    async def remove_by_content(
        self,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID | None = None,
    ) -> None:
        """
        Remove content from the search index by type and ID.

        Parameters
        ----------
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.
        organization_id : UUID | None
            If provided, only remove for this organization.
            If None, removes all entries across all orgs.

        """
        urn = build_content_urn(content_type, content_id)
        await self.remove(urn, organization_id)


def build_content_urn(content_type: ContentType, content_id: UUID) -> str:
    """
    Build a URN for content.

    Parameters
    ----------
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.

    Returns
    -------
    str
        URN in format `urn:uniffy:content:<type>:<id>`

    """
    return f"urn:uniffy:content:{content_type.value}:{content_id}"
