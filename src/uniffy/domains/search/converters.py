"""Proto <-> domain conversions for search."""

from uniffy_proto.search.v1.search_pb2 import (
    SearchResultItem,
    SearchResultType,
    UrnMetadata,
)

from uniffy.domains.search.queries import SearchResult

# ─────────────────────────────────────────────────────────────────────────────
# Entity type string <-> Proto enum mapping
# ─────────────────────────────────────────────────────────────────────────────

ENTITY_TYPE_TO_PROTO: dict[str, SearchResultType] = {
    "note": SearchResultType.SEARCH_RESULT_TYPE_NOTE,
    "file": SearchResultType.SEARCH_RESULT_TYPE_FILE,
    "chat": SearchResultType.SEARCH_RESULT_TYPE_CHAT,
    "user": SearchResultType.SEARCH_RESULT_TYPE_USER,
    "calendar_event": SearchResultType.SEARCH_RESULT_TYPE_CALENDAR_EVENT,
    "project": SearchResultType.SEARCH_RESULT_TYPE_PROJECT,
    "task": SearchResultType.SEARCH_RESULT_TYPE_TASK,
    "agent": SearchResultType.SEARCH_RESULT_TYPE_AGENT,
    "prompt": SearchResultType.SEARCH_RESULT_TYPE_PROMPT,
    "chat_message": SearchResultType.SEARCH_RESULT_TYPE_CHAT_MESSAGE,
}

PROTO_TO_ENTITY_TYPE: dict[SearchResultType, str] = {v: k for k, v in ENTITY_TYPE_TO_PROTO.items()}


def entity_type_to_proto(entity_type: str) -> SearchResultType:
    """
    Convert entity type string to proto enum.

    Parameters
    ----------
    entity_type : str
        Entity type string (e.g., 'note', 'file').

    Returns
    -------
    SearchResultType
        Proto enum value.

    """
    return ENTITY_TYPE_TO_PROTO.get(
        entity_type.lower(),
        SearchResultType.SEARCH_RESULT_TYPE_UNSPECIFIED,
    )


def proto_to_entity_type(proto_type: SearchResultType) -> str | None:
    """
    Convert proto enum to entity type string.

    Parameters
    ----------
    proto_type : SearchResultType
        Proto enum value.

    Returns
    -------
    str | None
        Entity type string or None if unspecified.

    """
    if proto_type == SearchResultType.SEARCH_RESULT_TYPE_UNSPECIFIED:
        return None
    return PROTO_TO_ENTITY_TYPE.get(proto_type)


# ─────────────────────────────────────────────────────────────────────────────
# SearchResult -> Proto conversion
# ─────────────────────────────────────────────────────────────────────────────


def search_result_to_proto(
    item: SearchResult,
    score: float | None = None,
) -> SearchResultItem:
    """
    Convert SearchResult to proto SearchResultItem.

    Parameters
    ----------
    item : SearchResult
        Search result from Meilisearch.
    score : float | None
        Optional relevance score override.

    Returns
    -------
    SearchResultItem
        Proto message.

    """
    # Use provided score, search_score from Meilisearch, or 0.0
    final_score = score if score is not None else (item.search_score or 0.0)

    return SearchResultItem(
        urn=item.urn,
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        score=final_score,
        metadata=item.metadata or {},
        tags=item.tags or [],
    )


# ─────────────────────────────────────────────────────────────────────────────
# SearchResult -> UrnMetadata conversion
# ─────────────────────────────────────────────────────────────────────────────


def search_result_to_urn_metadata(item: SearchResult) -> UrnMetadata:
    """
    Convert SearchResult to proto UrnMetadata.

    Includes live state fields in the metadata map for mention enrichment.

    Parameters
    ----------
    item : SearchResult
        Search result from Meilisearch.

    Returns
    -------
    UrnMetadata
        Lightweight proto message with title, description, type, URL,
        and live state fields in metadata.

    """
    # Start with existing metadata from Meilisearch
    metadata = dict(item.metadata) if item.metadata else {}

    # Include updated_at for "Updated X ago" display
    if item.updated_at:
        metadata["updated_at"] = item.updated_at.isoformat()

    # Merge live state fields into metadata map
    if item.status:
        metadata["status"] = item.status
    if item.due_date:
        metadata["due_date"] = item.due_date
    if item.assignee_name:
        metadata["assignee_name"] = item.assignee_name
    if item.processing_status:
        metadata["processing_status"] = item.processing_status
    if item.completed_tasks:
        metadata["completed_tasks"] = str(item.completed_tasks)
    if item.total_tasks:
        metadata["total_tasks"] = str(item.total_tasks)
    if item.member_count:
        metadata["member_count"] = str(item.member_count)
    if item.updated_by_name:
        metadata["updated_by_name"] = item.updated_by_name

    return UrnMetadata(
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        metadata=metadata,
    )
