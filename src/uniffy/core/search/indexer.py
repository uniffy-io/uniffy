"""
Search indexing utilities.

Provides the :class:`SearchIndexer` class for adding, updating, and
removing content from the unified search index using Meilisearch.

The indexer mirrors the new access control model: each document stores
``access_mode``, ``baseline_role``, ``owner_id``, the non-blocked
``shared_user_ids`` / ``shared_group_ids`` lists, and the
``blocked_user_ids`` / ``blocked_group_ids`` lists used for explicit
deny. The search filter builder combines these into a single permission
expression at query time.
"""

from uuid import UUID

from uniffy.core.types import AccessMode, ContentRole, ContentType


class SearchIndexer:
    """
    Utility for indexing content in unified search.

    Provides methods to add, update, and remove content from the
    Meilisearch index with proper permission denormalization.

    Note: This class no longer requires a database session since
    indexing is done via the Meilisearch HTTP API.

    """

    def __init__(self, session=None) -> None:
        """Initialize the indexer.

        Parameters
        ----------
        session : AsyncSession | None
            Deprecated, kept for backwards compatibility. Not used.

        """
        self._session = session

    async def index(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        owner_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
        keywords: str | None = None,
        description: str | None = None,
        shared_user_ids: list[UUID] | None = None,
        shared_group_ids: list[UUID] | None = None,
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float = 1.0,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Index or update content in the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name. Format: ``urn:uniffy:content:<type>:<id>``
        organization_id : UUID
            Organization scope.
        title : str
            Primary display and search target.
        entity_type : str
            Content type (``note``, ``file``, ``project``, ...).
        url_path : str
            Frontend route to navigate to.
        owner_id : UUID
            Owner of the content.
        access_mode : AccessMode
            Access mode value.
        baseline_role : ContentRole | None
            Baseline role for OPEN_TO_ORG mode, otherwise None.
        keywords : str | None
            Aggregated full-text content.
        description : str | None
            Preview snippet.
        shared_user_ids : list[UUID] | None
            Users with a non-BLOCKED ContentMember row.
        shared_group_ids : list[UUID] | None
            Groups with a non-BLOCKED ContentMember row.
        blocked_user_ids : list[UUID] | None
            Users with a BLOCKED ContentMember row. Used to exclude them
            from search even when the baseline would allow access.
        blocked_group_ids : list[UUID] | None
            Groups with a BLOCKED ContentMember row.
        tags : list[str] | None
            Tags associated with the content.
        rank_score : float
            Relevance booster.
        metadata : dict[str, str] | None
            Extra key-value metadata.

        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.index_document(
            urn=urn,
            organization_id=organization_id,
            title=title,
            entity_type=entity_type,
            url_path=url_path,
            owner_id=owner_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            content=keywords,
            description=description,
            shared_user_ids=shared_user_ids,
            shared_group_ids=shared_group_ids,
            blocked_user_ids=blocked_user_ids,
            blocked_group_ids=blocked_group_ids,
            tags=tags,
            rank_score=rank_score,
            metadata=metadata,
        )

    async def batch_index(
        self,
        items: list[dict],
    ) -> None:
        """Batch-index multiple documents in a single Meilisearch call.

        Each item must be a dict with the same keys as :meth:`index`.
        """
        if not items:
            return

        from datetime import UTC, datetime

        from uniffy.core.search.meilisearch import build_document_id, get_meilisearch_client

        documents = []
        for item in items:
            org_id = item["organization_id"]
            urn = item["urn"]
            documents.append({
                "id": build_document_id(urn, org_id),
                "urn": urn,
                "organization_id": str(org_id),
                "title": item.get("title", ""),
                "content": item.get("keywords", ""),
                "description": item.get("description", ""),
                "entity_type": item.get("entity_type", ""),
                "url_path": item.get("url_path", ""),
                "access_mode": item.get("access_mode", AccessMode.OWNER_ONLY),
                "baseline_role": item.get("baseline_role"),
                "owner_id": str(item.get("owner_id", "")),
                "shared_user_ids": [str(uid) for uid in (item.get("shared_user_ids") or [])],
                "shared_group_ids": [str(gid) for gid in (item.get("shared_group_ids") or [])],
                "blocked_user_ids": [str(uid) for uid in (item.get("blocked_user_ids") or [])],
                "blocked_group_ids": [str(gid) for gid in (item.get("blocked_group_ids") or [])],
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
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
    ) -> None:
        """Partial update of membership metadata in the search index.

        Replaces the shared / blocked lists without touching any other
        field on the document.
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_sharing(
            urn=urn,
            organization_id=organization_id,
            shared_user_ids=shared_user_ids,
            shared_group_ids=shared_group_ids,
            blocked_user_ids=blocked_user_ids or [],
            blocked_group_ids=blocked_group_ids or [],
        )

    async def update_access_policy(
        self,
        urn: str,
        organization_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
        owner_id: UUID,
    ) -> None:
        """Partial update of the access policy fields on a document."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_access_policy(
            urn=urn,
            organization_id=organization_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            owner_id=owner_id,
        )

    async def remove(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        """Remove content from the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name to remove.
        organization_id : UUID | None
            If provided, only remove for this organization. If None,
            removes all entries for this URN across orgs.

        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.delete_document(urn, organization_id)

    async def remove_by_filter(self, filter_expr: str) -> None:
        """Bulk-remove documents matching a Meilisearch filter expression.

        Used for cascade deletes -- e.g. dropping every chat_message
        when its parent channel is deleted, or every task under a
        deleted project. The filter must reference filterable
        attributes only (see ``filterable_attributes`` in
        ``meilisearch.py``).
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.delete_documents_by_filter_expr(filter_expr)

    async def remove_by_content(
        self,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID | None = None,
    ) -> None:
        """Remove content from the search index by type and ID."""
        urn = build_content_urn(content_type, content_id)
        await self.remove(urn, organization_id)


def build_content_urn(content_type: ContentType, content_id: UUID) -> str:
    """Build a URN for content.

    Returns
    -------
    str
        URN in format ``urn:uniffy:content:<type>:<id>``

    """
    return f"urn:uniffy:content:{content_type.value}:{content_id}"
