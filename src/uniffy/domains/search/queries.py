"""Meilisearch search execution.

Permission filtering combines `access_mode` / `baseline_role` with explicit
`ContentMember` grants so accessible documents are returned to the user.
"""

import contextlib
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.content.references import parse_urn
from uniffy.core.search import get_meilisearch_client
from uniffy.core.search.meilisearch import SearchCandidateScope

logger = logger.bind(component="search.queries")


class UrnAvailability(StrEnum):
    AVAILABLE = "AVAILABLE"
    RESTRICTED = "RESTRICTED"
    DELETED = "DELETED"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass
class SearchResult:
    """Meilisearch hit with the fields used for display and navigation."""

    urn: str
    organization_id: UUID
    title: str
    description: str | None
    entity_type: str
    url_path: str
    access_mode: str
    baseline_role: str | None
    owner_id: UUID
    tags: list[str] | None
    metadata: dict[str, str] | None
    updated_at: datetime | None
    rank_score: float
    search_score: float | None  # Meilisearch ranking score

    # _formatted variants; matched spans wrapped in HIGHLIGHT_PRE/POST_TAG.
    title_highlighted: str | None = None
    description_highlighted: str | None = None

    availability: UrnAvailability = UrnAvailability.AVAILABLE
    can_request_access: bool = False

    status: str | None = None
    due_date: str | None = None
    assignee_name: str | None = None
    processing_status: str | None = None
    completed_tasks: int = 0
    total_tasks: int = 0
    member_count: int = 0
    updated_by_name: str | None = None

    # Extended task fields
    priority: str | None = None
    priority_label: str | None = None
    priority_color: str | None = None
    status_label: str | None = None
    status_color: str | None = None
    task_type: str | None = None
    task_number: int = 0
    project_name: str | None = None
    project_slug: str | None = None
    project_color: str | None = None
    subtask_completed: int = 0
    subtask_total: int = 0
    blocked_by_count: int = 0
    assignee_ids: list[str] | None = None

    # Calendar fields
    event_start_time: str | None = None
    event_end_time: str | None = None
    event_is_all_day: bool = False
    event_location: str | None = None
    event_meeting_url: str | None = None
    event_channel_id: str | None = None
    event_status: str | None = None

    # File fields
    file_mime_type: str | None = None
    file_size: int = 0

    # Note fields
    note_node_type: str | None = None

    # Chat fields
    channel_type: str | None = None

    # Agent fields
    agent_emoji: str | None = None
    agent_theme_color: str | None = None

    # User fields
    user_avatar_url: str | None = None
    user_email: str | None = None

    # Shared
    content_tags: list[str] | None = None

    @classmethod
    def from_meilisearch_hit(cls, hit: dict[str, Any]) -> SearchResult:
        updated_at = None
        if hit.get("updated_at"):
            with contextlib.suppress(ValueError, TypeError):
                # Aware UTC, so isoformat() carries an offset - a bare timestamp
                # string gets parsed as LOCAL time by `new Date()` in the browser.
                updated_at = datetime.fromtimestamp(hit["updated_at"], UTC)

        formatted = hit.get("_formatted") or {}
        metadata = hit.get("metadata") or {}

        return cls(
            urn=hit.get("urn", ""),
            organization_id=UUID(hit["organization_id"]),
            title=hit.get("title", ""),
            description=hit.get("description"),
            title_highlighted=formatted.get("title"),
            description_highlighted=formatted.get("description"),
            entity_type=hit.get("entity_type", ""),
            url_path=hit.get("url_path", ""),
            access_mode=hit.get("access_mode", "OWNER_ONLY"),
            baseline_role=hit.get("baseline_role"),
            owner_id=UUID(hit["owner_id"]),
            tags=hit.get("tags"),
            metadata=hit.get("metadata"),
            updated_at=updated_at,
            rank_score=hit.get("rank_score", 1.0),
            search_score=hit.get("_rankingScore"),
            # User docs denormalize these at index time, tier-gated there;
            # resolve must not re-read them from the database.
            user_avatar_url=metadata.get("avatar_url"),
            user_email=metadata.get("user_email"),
        )


@dataclass(frozen=True)
class UrnLookupResult:
    documents: dict[str, SearchResult]
    failed_urns: frozenset[str]

    @property
    def complete(self) -> bool:
        return not self.failed_urns


# A result whose ranking score falls below this fraction of the page's best
# score is a weak (typo / partial-word) match; type tiers must not lift it
# above full matches.
_STRONG_MATCH_RATIO = 0.85


def apply_type_priority(
    results: list[SearchResult],
    type_priority: list[str],
) -> list[SearchResult]:
    """Stable re-rank: match-strength bucket, then the caller's type tier,
    then the original Meilisearch order. Types not listed rank after all
    listed types within their bucket.
    """
    if not type_priority or not results:
        return results

    tier = {entity_type: i for i, entity_type in enumerate(type_priority)}
    fallback_tier = len(type_priority)
    scores = [r.search_score for r in results if r.search_score is not None]
    strong_floor = max(scores) * _STRONG_MATCH_RATIO if scores else None

    def sort_key(item: tuple[int, SearchResult]) -> tuple[int, int, int]:
        index, result = item
        if strong_floor is None or result.search_score is None:
            bucket = 0
        else:
            bucket = 0 if result.search_score >= strong_floor else 1
        return (bucket, tier.get(result.entity_type, fallback_tier), index)

    return [r for _, r in sorted(enumerate(results), key=sort_key)]


async def execute_search(
    query_text: str,
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: list[UUID],
    type_filters: list[str] | None = None,
    tag_filters: list[str] | None = None,
    my_content_only: bool = False,
    owner_filter: UUID | None = None,
    metadata_filters: dict[str, str] | None = None,
    limit: int = 20,
    offset: int = 0,
    name_matches_only: bool = False,
    candidate_scope: SearchCandidateScope = SearchCandidateScope.MEMBER_HINT,
) -> tuple[list[SearchResult], int]:
    client = get_meilisearch_client()

    results = await client.search(
        query=query_text,
        organization_id=organization_id,
        user_id=user_id,
        user_group_ids=user_group_ids,
        type_filters=type_filters,
        tag_filters=tag_filters,
        my_content_only=my_content_only,
        attributes_to_search_on=["title"] if name_matches_only else None,
        owner_filter=owner_filter,
        metadata_filters=metadata_filters,
        limit=limit,
        offset=offset,
        candidate_scope=candidate_scope,
    )

    search_results = [SearchResult.from_meilisearch_hit(hit) for hit in results.hits]

    return search_results, results.estimated_total_hits or len(search_results)


async def get_raw_documents_by_urns(
    urns: list[str],
    organization_id: UUID,
) -> UrnLookupResult:
    valid_urns = [urn for urn in urns if parse_urn(urn) is not None]
    if not valid_urns:
        return UrnLookupResult(documents={}, failed_urns=frozenset())

    client = get_meilisearch_client()
    lookup = await client.get_documents_by_urns(valid_urns, organization_id)
    return UrnLookupResult(
        documents={
            urn: SearchResult.from_meilisearch_hit(doc) for urn, doc in lookup.documents.items()
        },
        failed_urns=lookup.failed_urns,
    )
