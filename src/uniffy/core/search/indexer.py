"""Meilisearch indexing facade. Documents carry the full access policy so
query-time filters can short-circuit on permissions.

Removals are write-ahead: a ``search_removal_queue`` row is committed
BEFORE the Meilisearch call and deleted after it succeeds. A crash or
outage anywhere in between leaves the row for the flush worker, so a
deleted row can never stay searchable forever.
"""

import asyncio
from uuid import UUID

from loguru import logger

from uniffy.core.types import AccessMode, ContentRole, ContentType

logger = logger.bind(component="search.indexer")

_RETRY_DELAYS_SECONDS = (1, 5, 15, 60, 120)
_retry_tasks: set[asyncio.Task] = set()


async def _record_pending_removal(
    urn: str | None = None,
    filter_expr: str | None = None,
    organization_id: UUID | None = None,
) -> UUID | None:
    """Commit the removal intent in its own transaction; the caller's session
    may be mid-flow or absent. Returns the row id, or None when the insert
    failed and a detached retry task took over.
    """
    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.db import open_session

    row = SearchRemovalQueue(
        urn=urn,
        filter_expr=filter_expr,
        organization_id=organization_id,
    )
    try:
        async with open_session() as session:
            session.add(row)
            await session.commit()
        return row.id
    except Exception:
        logger.warning(
            f"Failed to record search removal, retrying in background: "
            f"urn={urn} filter={filter_expr}"
        )
        task = asyncio.create_task(_record_removal_with_retry(urn, filter_expr, organization_id))
        _retry_tasks.add(task)
        task.add_done_callback(_retry_tasks.discard)
        return None


async def _record_removal_with_retry(
    urn: str | None,
    filter_expr: str | None,
    organization_id: UUID | None,
) -> None:
    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.db import open_session

    for delay in _RETRY_DELAYS_SECONDS:
        await asyncio.sleep(delay)
        try:
            async with open_session() as session:
                session.add(
                    SearchRemovalQueue(
                        urn=urn,
                        filter_expr=filter_expr,
                        organization_id=organization_id,
                    )
                )
                await session.commit()
            logger.info(f"Recorded search removal after retry: urn={urn} filter={filter_expr}")
            return
        except Exception:
            continue
    logger.error(
        f"Giving up recording search removal after "
        f"{len(_RETRY_DELAYS_SECONDS)} retries: urn={urn} filter={filter_expr}"
    )


async def _clear_pending_removal(row_id: UUID) -> None:
    """Best-effort: a leftover row is harmless, the flush worker re-deletes
    an already-deleted doc (idempotent) and drops the row.
    """
    from sqlalchemy import delete as sa_delete

    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.db import open_session

    try:
        async with open_session() as session:
            await session.execute(
                sa_delete(SearchRemovalQueue).where(SearchRemovalQueue.id == row_id)
            )
            await session.commit()
    except Exception:
        logger.warning(f"Failed to clear completed search removal row {row_id}")


# Entity-type weight used as the first query-time sort tiebreaker after
# relevance: primary content outranks conversational noise. Values are
# static per type; a doc-level override can still be passed explicitly.
RANK_SCORE_BY_ENTITY_TYPE: dict[str, float] = {
    "note": 1.0,
    "project": 1.0,
    "task": 0.9,
    "file": 0.9,
    "folder": 0.9,
    "calendar_event": 0.9,
    "chat": 0.9,
    "agent_chat": 0.8,
    "agent_folder": 0.8,
    "room": 0.8,
    "agent": 0.8,
    "user": 0.8,
    "team": 0.8,
    "agent_cron_task": 0.7,
    "tag": 0.6,
    "chat_message": 0.3,
}

_FALLBACK_RANK_SCORE = 0.8


def default_rank_score(entity_type: str) -> float:
    return RANK_SCORE_BY_ENTITY_TYPE.get(entity_type.lower(), _FALLBACK_RANK_SCORE)


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
        attendee_user_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Index or update one content document."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        if rank_score is None:
            rank_score = default_rank_score(entity_type)

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
            attendee_user_ids=attendee_user_ids,
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
            entity_type = str(item.get("entity_type", "")).lower()
            documents.append({
                "id": build_document_id(urn, org_id),
                "urn": urn,
                "organization_id": str(org_id),
                "title": item.get("title", ""),
                "content": item.get("keywords", ""),
                "description": item.get("description", ""),
                "entity_type": entity_type,
                "url_path": item.get("url_path", ""),
                "access_mode": item.get("access_mode", AccessMode.OWNER_ONLY),
                "baseline_role": item.get("baseline_role"),
                "owner_id": str(item.get("owner_id", "")),
                "shared_user_ids": [str(uid) for uid in (item.get("shared_user_ids") or [])],
                "shared_group_ids": [str(gid) for gid in (item.get("shared_group_ids") or [])],
                "blocked_user_ids": [str(uid) for uid in (item.get("blocked_user_ids") or [])],
                "blocked_group_ids": [str(gid) for gid in (item.get("blocked_group_ids") or [])],
                "attendee_user_ids": [str(uid) for uid in (item.get("attendee_user_ids") or [])],
                "tags": item.get("tags") or [],
                "rank_score": item.get("rank_score") or default_rank_score(entity_type),
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

    async def update_attendees(
        self,
        urn: str,
        organization_id: UUID,
        attendee_user_ids: list[UUID],
    ) -> None:
        """Replace the ``attendee_user_ids`` list on the document; other fields untouched."""
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        await client.update_document_attendees(
            urn=urn,
            organization_id=organization_id,
            attendee_user_ids=attendee_user_ids,
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

    async def update_access_policy_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, AccessMode, ContentRole | None]],
    ) -> int:
        """Bulk access-policy update via one ``update_documents`` call; ``items``
        is ``(urn, access_mode, baseline_role)``. Returns the documents written.
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        client = get_meilisearch_client()
        return await client.update_document_access_policy_bulk(
            organization_id=organization_id,
            items=[
                (urn, access_mode.value, baseline_role.value if baseline_role else None)
                for urn, access_mode, baseline_role in items
            ],
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
        """Remove a URN from the index; ``organization_id=None`` removes every
        org's copy. Write-ahead: the queue row lands first, the inline
        Meilisearch call is the fast path, and any failure (including a crash
        mid-call) leaves the row for the flush worker. Never raises - the
        caller's delete already committed and must not fail over search.
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        row_id = await _record_pending_removal(urn=urn, organization_id=organization_id)
        try:
            client = get_meilisearch_client()
            await client.delete_document(urn, organization_id)
        except Exception:
            logger.warning(f"Inline search removal failed, queued for retry: {urn}")
            return
        if row_id is not None:
            await _clear_pending_removal(row_id)

    async def remove_by_filter(self, filter_expr: str) -> None:
        """Bulk-remove documents matching a Meilisearch filter expression
        (filterable attributes only). Same write-ahead contract as
        :meth:`remove`; never raises.
        """
        from uniffy.core.search.meilisearch import get_meilisearch_client

        row_id = await _record_pending_removal(filter_expr=filter_expr)
        try:
            client = get_meilisearch_client()
            await client.delete_documents_by_filter_expr(filter_expr)
        except Exception:
            logger.warning(f"Inline search filter-removal failed, queued for retry: {filter_expr}")
            return
        if row_id is not None:
            await _clear_pending_removal(row_id)

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
