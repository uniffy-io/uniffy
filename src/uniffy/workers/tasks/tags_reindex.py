"""Tag reindex workers: refresh per-URN `tags` arrays and per-tag entity docs.

Both jobs re-read current state, so they are idempotent under retries.
"""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.valkey.tags import EVENT_TAG_UPDATED, publish_tag_event
from uniffy.db import open_session
from uniffy.domains.tags.operations import (
    TagOperations,
    _format_breakdown,
    _format_pipes,
)

LOGGER_COMPONENT = "tags.reindex"

_BATCH_SIZE = 500


async def reindex_tag_urns(
    ctx: dict[str, Any],
    organization_id: str,
    content_urns: list[str],
) -> dict[str, Any]:
    """Rewrite the `tags` array on every URN, chunked at 500 per Meilisearch call."""
    if not content_urns:
        return {"status": "skipped", "reason": "no_urns"}

    org_id = UUID(organization_id)
    indexer = SearchIndexer()
    processed = 0
    skipped = 0

    async with open_session() as session:
        ops = TagOperations(session)

        for start in range(0, len(content_urns), _BATCH_SIZE):
            batch = content_urns[start : start + _BATCH_SIZE]
            tags_by_urn = await ops.get_for_urns(
                organization_id=org_id, content_urns=batch
            )
            items: list[tuple[str, list[str]]] = [
                (urn, [t.slug for t in (tags_by_urn.get(urn) or [])])
                for urn in batch
            ]
            try:
                await indexer.update_tags_bulk(organization_id=org_id, items=items)
                processed += len(items)
            except Exception:
                logger.warning(
                    f"reindex_tag_urns: bulk update failed for chunk size={len(items)}",
                    component=LOGGER_COMPONENT,
                )
                skipped += len(items)

    logger.info(
        f"reindex_tag_urns processed={processed} skipped={skipped}",
        component=LOGGER_COMPONENT,
    )
    return {"status": "complete", "processed": processed, "skipped": skipped}


async def reindex_tag_doc(
    ctx: dict[str, Any],
    organization_id: str,
    tag_id: str,
) -> dict[str, Any]:
    """Refresh a tag's Meilisearch entity doc and broadcast `tag.updated`."""
    org_id = UUID(organization_id)
    tid = UUID(tag_id)

    async with open_session() as session:
        ops = TagOperations(session)
        tag = await ops._get_by_id(org_id, tid)
        if tag is None:
            return {"status": "not_found"}

        breakdown, recent_urns, recent_at = await ops._compute_tag_breakdown(tid)
        usage_count = await ops._get_usage_count(org_id, tid)
        await ops._index_tag_entity(
            tag,
            usage_count=usage_count,
            breakdown_data=(breakdown, recent_urns, recent_at),
        )

    state_payload = {
        "id": str(tag.id),
        "urn": tag.urn,
        "title": tag.name,
        "slug": tag.slug,
        "color": tag.color or "",
        "description": tag.description or "",
        "usage_count": str(usage_count),
        "usage_count_by_domain": _format_breakdown(breakdown),
        "recent_assignment_urns": _format_pipes(recent_urns),
        "recent_assignment_at": _format_pipes(recent_at),
    }

    await publish_tag_event(
        org_id,
        EVENT_TAG_UPDATED,
        {"tag": state_payload, "source": "reindex"},
    )

    return {"status": "ok", "tag_id": tag_id}
