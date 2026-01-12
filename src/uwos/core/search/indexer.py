"""
Search indexing utilities.

Provides the SearchIndexer class for adding, updating, and removing
content from the unified search index.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.models.search.search_index import SearchIndex
from uwos.core.types import ContentType


class SearchIndexer:
    """
    Utility for indexing content in unified search.

    Provides methods to add, update, and remove content from
    the search index with proper permission denormalization.

    Parameters
    ----------
    session : AsyncSession
        Database session for queries.

    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize the search indexer.

        Parameters
        ----------
        session : AsyncSession
            Database session for queries.

        """
        self.session = session

    async def index(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        visibility: str,
        owner_id: UUID,
        keywords: str | None = None,
        description: str | None = None,
        shared_group_ids: list[UUID] | None = None,
        shared_user_ids: list[UUID] | None = None,
        rank_score: float = 1.0,
    ) -> None:
        """
        Index or update content in the search index.

        Uses PostgreSQL upsert to insert or update the search entry.

        Parameters
        ----------
        urn : str
            Universal Resource Name. Format: `urn:uwos:content:<type>:<id>`
        organization_id : UUID
            Organization ID for tenant isolation.
        title : str
            Main display title and primary search target.
        entity_type : str
            Type of content ('note', 'file', 'book', etc).
        url_path : str
            Frontend route to navigate to.
        visibility : str
            Visibility scope ('PRIVATE', 'GROUP', 'ORGANIZATION', 'PUBLIC').
        owner_id : UUID
            Owner of the content.
        keywords : str | None
            Aggregated text for indexing.
        description : str | None
            Subtitle or short snippet for context.
        shared_group_ids : list[UUID] | None
            List of Group IDs this content is shared with.
        shared_user_ids : list[UUID] | None
            List of User IDs this content is explicitly shared with.
        rank_score : float
            Relevance booster (default 1.0).

        """
        stmt = insert(SearchIndex).values(
            urn=urn,
            organization_id=organization_id,
            title=title,
            description=description,
            keywords=keywords,
            entity_type=entity_type,
            url_path=url_path,
            visibility=visibility,
            owner_id=owner_id,
            shared_group_ids=shared_group_ids,
            shared_user_ids=shared_user_ids,
            updated_at=datetime.now(UTC),
            rank_score=rank_score,
        )

        # Upsert: update if URN exists
        stmt = stmt.on_conflict_do_update(
            index_elements=["urn"],
            set_={
                "title": stmt.excluded.title,
                "description": stmt.excluded.description,
                "keywords": stmt.excluded.keywords,
                "url_path": stmt.excluded.url_path,
                "visibility": stmt.excluded.visibility,
                "owner_id": stmt.excluded.owner_id,
                "shared_group_ids": stmt.excluded.shared_group_ids,
                "shared_user_ids": stmt.excluded.shared_user_ids,
                "updated_at": stmt.excluded.updated_at,
                "rank_score": stmt.excluded.rank_score,
            },
        )

        await self.session.execute(stmt)

    async def remove(self, urn: str) -> None:
        """
        Remove content from the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name to remove.

        """
        await self.session.execute(delete(SearchIndex).where(SearchIndex.urn == urn))

    async def remove_by_content(
        self,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """
        Remove content from the search index by type and ID.

        Parameters
        ----------
        content_type : ContentType
            Type of content.
        content_id : UUID
            ID of the content.

        """
        urn = build_content_urn(content_type, content_id)
        await self.remove(urn)


def build_content_urn(content_type: ContentType, content_id: UUID) -> str:
    """
    Build a URN for content.

    Parameters
    ----------
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.

    Returns
    -------
    str
        URN in format `urn:uwos:content:<type>:<id>`

    """
    return f"urn:uwos:content:{content_type.value}:{content_id}"
