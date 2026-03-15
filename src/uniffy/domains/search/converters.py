"""Proto <-> domain conversions for search."""

from uniffy.domains.search.queries import SearchResult
from uniffy.gen.search.v1.search_pb2 import (
    SearchResultItem,
    SearchResultType,
    UrnMetadata,
)

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

    Parameters
    ----------
    item : SearchResult
        Search result from Meilisearch.

    Returns
    -------
    UrnMetadata
        Lightweight proto message with title, description, type, and URL.

    """
    return UrnMetadata(
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        metadata=item.metadata or {},
    )
