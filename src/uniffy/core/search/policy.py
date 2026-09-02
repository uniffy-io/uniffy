"""Uniffy document schema and candidate-filter policy."""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from uniffy.core.search.engine import (
    SearchExists,
    SearchFilter,
    SearchNot,
    SearchRankingRule,
    SearchSchema,
    SearchTerm,
    all_of,
    any_of,
)
from uniffy.core.search.stop_words import STOP_WORDS


class SearchCandidateScope(StrEnum):
    MEMBER_HINT = "MEMBER_HINT"
    ORGANIZATION = "ORGANIZATION"


HIGHLIGHT_PRE_TAG = "\ue000"
HIGHLIGHT_POST_TAG = "\ue001"

SEARCH_HIT_FIELDS = (
    "urn",
    "organization_id",
    "title",
    "description",
    "entity_type",
    "url_path",
    "access_mode",
    "baseline_role",
    "owner_id",
    "tags",
    "metadata",
    "updated_at",
    "rank_score",
)

WORKSPACE_SEARCH_SCHEMA = SearchSchema(
    primary_key="id",
    searchable_fields=("title", "content", "tags", "description"),
    filterable_fields=(
        "urn",
        "organization_id",
        "entity_type",
        "access_mode",
        "baseline_role",
        "owner_id",
        "shared_user_ids",
        "shared_group_ids",
        "blocked_user_ids",
        "blocked_group_ids",
        "attendee_user_ids",
        "tags",
        "updated_at",
        "metadata.channel_id",
        "metadata.sender_id",
        "metadata.project_id",
        "metadata.folder_id",
        "metadata.visibility",
    ),
    sortable_fields=("updated_at", "rank_score", "title"),
    ranking_rules=(
        SearchRankingRule.WORDS,
        SearchRankingRule.TYPO,
        SearchRankingRule.PROXIMITY,
        SearchRankingRule.ATTRIBUTE,
        SearchRankingRule.SORT,
        SearchRankingRule.EXACTNESS,
    ),
    stop_words=STOP_WORDS,
    synonyms={
        "meeting": ("call",),
        "call": ("meeting",),
        "doc": ("document", "note"),
        "document": ("doc", "note"),
        "note": ("doc", "document"),
        "image": ("photo", "picture"),
        "photo": ("image", "picture"),
        "picture": ("image", "photo"),
        "task": ("todo",),
        "todo": ("task",),
        "folder": ("directory",),
        "directory": ("folder",),
    },
)

FILTERABLE_METADATA_KEYS = frozenset(
    field.removeprefix("metadata.")
    for field in WORKSPACE_SEARCH_SCHEMA.filterable_fields
    if field.startswith("metadata.")
)


@dataclass(frozen=True, slots=True)
class SearchDocumentInput:
    urn: str
    organization_id: UUID
    title: str
    entity_type: str
    url_path: str
    owner_id: UUID
    access_mode: str
    baseline_role: str | None
    content: str | None = None
    description: str | None = None
    shared_user_ids: tuple[UUID, ...] = ()
    shared_group_ids: tuple[UUID, ...] = ()
    blocked_user_ids: tuple[UUID, ...] = ()
    blocked_group_ids: tuple[UUID, ...] = ()
    attendee_user_ids: tuple[UUID, ...] = ()
    tags: tuple[str, ...] = ()
    rank_score: float = 1.0
    metadata: dict[str, str] | None = None


def build_document_id(urn: str, organization_id: UUID) -> str:
    safe_urn = urn.replace(":", "-")
    return f"{safe_urn}__{organization_id}"


def parse_document_id(document_id: str) -> tuple[str, str]:
    parts = document_id.rsplit("__", 1)
    if len(parts) != 2:  # noqa: PLR2004 - serialized identifier shape
        raise ValueError(f"Invalid document ID format: {document_id}")
    safe_urn, organization_id = parts
    urn = safe_urn.replace("urn-uniffy-content-", "urn:uniffy:content:", 1)
    return urn, organization_id


def build_search_document(item: SearchDocumentInput) -> dict[str, Any]:
    return {
        "id": build_document_id(item.urn, item.organization_id),
        "urn": item.urn,
        "organization_id": str(item.organization_id),
        "title": item.title,
        "content": item.content or "",
        "description": item.description or "",
        "entity_type": item.entity_type.lower(),
        "url_path": item.url_path,
        "access_mode": item.access_mode,
        "baseline_role": item.baseline_role,
        "owner_id": str(item.owner_id),
        "shared_user_ids": [str(value) for value in item.shared_user_ids],
        "shared_group_ids": [str(value) for value in item.shared_group_ids],
        "blocked_user_ids": [str(value) for value in item.blocked_user_ids],
        "blocked_group_ids": [str(value) for value in item.blocked_group_ids],
        "attendee_user_ids": [str(value) for value in item.attendee_user_ids],
        "tags": list(item.tags),
        "rank_score": item.rank_score,
        "metadata": item.metadata or {},
        "updated_at": int(datetime.now(UTC).timestamp()),
    }


def build_permission_filter(
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: tuple[UUID, ...] = (),
    my_content_only: bool = False,
    owner_filter: UUID | None = None,
) -> SearchFilter:
    user = str(user_id)
    allow: list[SearchFilter] = [
        all_of(
            SearchNot(SearchTerm("entity_type", "chat_message")),
            SearchTerm("owner_id", user),
        ),
        SearchTerm("shared_user_ids", user),
        SearchTerm("attendee_user_ids", user),
        all_of(
            SearchTerm("access_mode", "OPEN_TO_ORG"),
            SearchExists("baseline_role"),
        ),
    ]
    allow.extend(SearchTerm("shared_group_ids", str(group_id)) for group_id in user_group_ids)

    exclusions: list[SearchFilter] = [SearchNot(SearchTerm("blocked_user_ids", user))]
    exclusions.extend(
        SearchNot(SearchTerm("blocked_group_ids", str(group_id))) for group_id in user_group_ids
    )

    private_event = any_of(
        SearchNot(SearchTerm("metadata.visibility", "PRIVATE")),
        SearchTerm("owner_id", user),
        SearchTerm("attendee_user_ids", user),
    )
    base = all_of(
        SearchTerm("organization_id", str(organization_id)),
        all_of(*exclusions),
        any_of(*allow),
        private_event,
    )
    if my_content_only:
        return all_of(base, SearchTerm("owner_id", user))
    if owner_filter is not None:
        return all_of(base, SearchTerm("owner_id", str(owner_filter)))
    return base


def build_candidate_filter(
    *,
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: tuple[UUID, ...] = (),
    type_filters: tuple[str, ...] = (),
    tag_filters: tuple[str, ...] = (),
    my_content_only: bool = False,
    owner_filter: UUID | None = None,
    metadata_filters: dict[str, str] | None = None,
    candidate_scope: SearchCandidateScope = SearchCandidateScope.MEMBER_HINT,
) -> SearchFilter:
    if candidate_scope is SearchCandidateScope.ORGANIZATION:
        base: SearchFilter = SearchTerm("organization_id", str(organization_id))
        if my_content_only:
            base = all_of(base, SearchTerm("owner_id", str(user_id)))
        if owner_filter is not None:
            base = all_of(base, SearchTerm("owner_id", str(owner_filter)))
    else:
        base = build_permission_filter(
            organization_id,
            user_id,
            user_group_ids,
            my_content_only,
            owner_filter,
        )

    filters = [base]
    if type_filters:
        filters.append(any_of(*(SearchTerm("entity_type", value) for value in type_filters)))
    filters.extend(SearchTerm("tags", value) for value in tag_filters)
    if metadata_filters:
        filters.extend(
            SearchTerm(f"metadata.{key}", value)
            for key, value in metadata_filters.items()
            if key in FILTERABLE_METADATA_KEYS
        )
    return all_of(*filters)
