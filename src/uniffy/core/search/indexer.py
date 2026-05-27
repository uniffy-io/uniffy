"""Meilisearch indexing facade. Documents carry the full access policy so
query-time filters can short-circuit on permissions.
"""

from uuid import UUID

from uniffy.core.types import AccessMode, ContentRole, ContentType


class SearchIndexer:
    """Add, update, and remove content from the Meilisearch index."""

    def __init__(self, session=None) -> None:
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
        """Index or update one content document."""
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
        """Batch-index multiple documents in one Meilisearch call; items have
        the same keys as :meth:`index`.
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
        """Replace the shared / blocked lists on the document; other fields untouched."""
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
        """Replace the access-policy fields on a document."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_access_policy(
            urn=urn,
            organization_id=organization_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
            owner_id=owner_id,
        )

    async def update_tags_for_urn(
        self,
        urn: str,
        organization_id: UUID,
        tags: list[str],
    ) -> None:
        """Replace the ``tags`` array; no-op when the document is absent from the index."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_tags(
            urn=urn,
            organization_id=organization_id,
            tags=tags,
        )

    async def update_tags_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, list[str]]],
    ) -> None:
        """Bulk ``tags`` update via one ``update_documents`` call; ``items``
        is ``(urn, tags)`` tuples.
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_tags_bulk(
            organization_id=organization_id,
            items=items,
        )

    async def remove(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        """Remove a URN from the index; ``organization_id=None`` removes every org's copy."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.delete_document(urn, organization_id)

    async def remove_by_filter(self, filter_expr: str) -> None:
        """Bulk-remove documents matching a Meilisearch filter expression
        (filterable attributes only).
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
    """``urn:uniffy:content:<type>:<id>``."""
    return f"urn:uniffy:content:{content_type.value}:{content_id}"
