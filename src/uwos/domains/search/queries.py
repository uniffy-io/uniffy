"""
Search query utilities with pg_trgm fuzzy matching.

This module provides the core search query builder that:
1. Uses trigram similarity for typo-tolerant matching
2. Applies permission filtering based on visibility
3. Supports type filtering
"""

from uuid import UUID

from sqlalchemy import Select, func, literal_column, or_, select
from sqlalchemy.dialects.postgresql import ARRAY, array
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.models.search.search_index import SearchIndex


def build_search_query(
    query_text: str,
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: list[UUID],
    type_filters: list[str] | None = None,
    limit: int = 20,
    similarity_threshold: float = 0.1,
) -> Select:
    """
    Build the fuzzy search query with permission filtering.

    Uses pg_trgm for trigram-based fuzzy matching on the keywords column.
    Results are filtered by visibility permissions and sorted by relevance.

    Parameters
    ----------
    query_text : str
        The search query string.
    organization_id : UUID
        Organization ID for tenant isolation.
    user_id : UUID
        User performing the search.
    user_group_ids : list[UUID]
        Group IDs the user belongs to.
    type_filters : list[str] | None
        Optional entity types to filter by (e.g., ['note', 'file']).
    limit : int
        Maximum number of results.
    similarity_threshold : float
        Minimum similarity score (0.0 to 1.0).

    Returns
    -------
    Select
        SQLAlchemy select query ready for execution.

    """
    # Calculate similarity score using pg_trgm
    # We use COALESCE to handle NULL keywords
    similarity_score = func.coalesce(
        func.similarity(SearchIndex.keywords, query_text),
        literal_column("0.0"),
    ).label("score")

    # Build the base query with score
    query = select(SearchIndex, similarity_score).where(
        SearchIndex.organization_id == organization_id
    )

    # ─────────────────────────────────────────────────────────────
    # Fuzzy matching condition
    # Match if:
    # 1. Trigram similarity on keywords meets threshold (% operator)
    # 2. OR title contains the query (case-insensitive)
    # 3. OR keywords contain the query (case-insensitive)
    # ─────────────────────────────────────────────────────────────
    search_pattern = f"%{query_text}%"
    fuzzy_condition = or_(
        # pg_trgm similarity operator (requires index)
        SearchIndex.keywords.op("%")(query_text),
        # Fallback: title ILIKE
        SearchIndex.title.ilike(search_pattern),
        # Fallback: keywords ILIKE
        SearchIndex.keywords.ilike(search_pattern),
    )
    query = query.where(fuzzy_condition)

    # ─────────────────────────────────────────────────────────────
    # Permission filtering
    # User can see content if:
    # 1. Visibility is ORGANIZATION (everyone in org can see)
    # 2. They own it
    # 3. Visibility is GROUP and they're in a shared group
    # 4. They're explicitly shared with (shared_user_ids)
    # ─────────────────────────────────────────────────────────────
    permission_conditions = [
        # Organization-wide visibility
        SearchIndex.visibility == "ORGANIZATION",
        # Owner access
        SearchIndex.owner_id == user_id,
    ]

    # Group access (if user is in any groups)
    if user_group_ids:
        # Use array overlap operator (&&) for group membership check
        # Cast to UUID[] to match column type
        user_groups_array = func.cast(
            array(user_group_ids),
            type_=ARRAY(PG_UUID()),
        )
        permission_conditions.append(
            (SearchIndex.visibility == "GROUP")
            & (SearchIndex.shared_group_ids.op("&&")(user_groups_array))
        )

    # Direct user sharing - cast to UUID[] to match column type
    user_id_array = func.cast(
        array([user_id]),
        type_=ARRAY(PG_UUID()),
    )
    permission_conditions.append(SearchIndex.shared_user_ids.op("@>")(user_id_array))

    query = query.where(or_(*permission_conditions))

    # ─────────────────────────────────────────────────────────────
    # Type filtering (optional)
    # ─────────────────────────────────────────────────────────────
    if type_filters:
        query = query.where(SearchIndex.entity_type.in_(type_filters))

    # ─────────────────────────────────────────────────────────────
    # Ordering and limit
    # Sort by: score DESC, then updated_at DESC, then rank_score DESC
    # ─────────────────────────────────────────────────────────────
    query = query.order_by(
        similarity_score.desc(),
        SearchIndex.updated_at.desc(),
        SearchIndex.rank_score.desc(),
    )
    query = query.limit(limit)

    return query


async def execute_search(
    session: AsyncSession,
    query_text: str,
    organization_id: UUID,
    user_id: UUID,
    user_group_ids: list[UUID],
    type_filters: list[str] | None = None,
    limit: int = 20,
) -> list[tuple[SearchIndex, float]]:
    """
    Execute a fuzzy search and return results with scores.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    query_text : str
        The search query string.
    organization_id : UUID
        Organization ID.
    user_id : UUID
        User performing the search.
    user_group_ids : list[UUID]
        Group IDs the user belongs to.
    type_filters : list[str] | None
        Optional entity types to filter by.
    limit : int
        Maximum number of results.

    Returns
    -------
    list[tuple[SearchIndex, float]]
        List of (SearchIndex, score) tuples.

    """
    query = build_search_query(
        query_text=query_text,
        organization_id=organization_id,
        user_id=user_id,
        user_group_ids=user_group_ids,
        type_filters=type_filters,
        limit=limit,
    )

    result = await session.execute(query)
    return [(row.SearchIndex, row.score) for row in result.all()]
