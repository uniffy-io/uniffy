"""Proto <-> domain conversions for search."""

from uwos.core.models.search.search_index import SearchIndex
from uwos.gen.search.v1.search_pb2 import (
    SearchResultItem,
    SearchResultType,
)

# ─────────────────────────────────────────────────────────────────────────────
# Entity type string <-> Proto enum mapping
# ─────────────────────────────────────────────────────────────────────────────

ENTITY_TYPE_TO_PROTO: dict[str, SearchResultType] = {
    "note": SearchResultType.SEARCH_RESULT_TYPE_NOTE,
    "file": SearchResultType.SEARCH_RESULT_TYPE_FILE,
    "chat": SearchResultType.SEARCH_RESULT_TYPE_CHAT,
    "user": SearchResultType.SEARCH_RESULT_TYPE_USER,
    "book": SearchResultType.SEARCH_RESULT_TYPE_BOOK,
    "calendar_event": SearchResultType.SEARCH_RESULT_TYPE_CALENDAR_EVENT,
    "password": SearchResultType.SEARCH_RESULT_TYPE_PASSWORD,
    "workflow": SearchResultType.SEARCH_RESULT_TYPE_WORKFLOW,
    "space": SearchResultType.SEARCH_RESULT_TYPE_SPACE,
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
# SearchIndex -> Proto conversion
# ─────────────────────────────────────────────────────────────────────────────


def search_result_to_proto(
    item: SearchIndex,
    score: float = 0.0,
) -> SearchResultItem:
    """
    Convert SearchIndex model to proto SearchResultItem.

    Parameters
    ----------
    item : SearchIndex
        Search index entry.
    score : float
        Relevance score from similarity calculation.

    Returns
    -------
    SearchResultItem
        Proto message.

    """
    return SearchResultItem(
        urn=item.urn,
        title=item.title,
        description=item.description or "",
        type=entity_type_to_proto(item.entity_type),
        url=item.url_path,
        score=score,
        metadata={},  # Can be extended later
    )
