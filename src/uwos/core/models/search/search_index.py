"""Search index model for fast global search."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import ARRAY, FLOAT
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class SearchIndex(SQLModel, table=True):
    """
    Search index projection for global search lookups.

    This table is a 'phonebook' of all content in the system (notes, files, books, etc.).
    It is optimized for fuzzy search (trigrams) and fast permission filtering.

    Attributes
    ----------
    urn : str
        Universal Resource Name (Primary Key). Format: `urn:uwos:<domain>:<type>:<id>`
    organization_id : UUID
        Tenant isolation.
    title : str
        Main display title and primary search target.
    description : str | None
        Subtitle or short snippet for context.
    keywords : str | None
        Aggregated text for indexing (Title + Tags + Filename + Snippet).
    entity_type : str
        Type of content ('note', 'file', 'book', etc).
    url_path : str
        Frontend route to navigate to (e.g., '/notes/123').
    visibility : str
        'private', 'group', 'organization', 'public'.
    owner_id : UUID
        Owner of the content.
    shared_group_ids : list[UUID]
        List of Group IDs this content is shared with.
    shared_user_ids : list[UUID]
        List of User IDs this content is explicitly shared with.
    updated_at : datetime
        Last time the content changed.
    rank_score : float
        Relevance booster (default 1.0).

    """

    __tablename__ = "search_index"

    urn: str = Field(primary_key=True, nullable=False)
    organization_id: UUID = Field(nullable=False, index=True)

    title: str = Field(nullable=False)
    description: str | None = Field(default=None)
    keywords: str | None = Field(default=None)  # Indexed with pg_trgm in migration

    entity_type: str = Field(nullable=False)
    url_path: str = Field(nullable=False)

    # Permission Denormalization
    visibility: str = Field(nullable=False, index=True)
    owner_id: UUID = Field(nullable=False)

    shared_group_ids: list[UUID] | None = Field(default=None, sa_column=Column(ARRAY(PG_UUID)))
    shared_user_ids: list[UUID] | None = Field(default=None, sa_column=Column(ARRAY(PG_UUID)))

    updated_at: datetime | None = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True)),
    )
    rank_score: float = Field(default=1.0, sa_column=Column(FLOAT, server_default="1.0"))

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<SearchIndex(urn={self.urn}, title={self.title}, type={self.entity_type})>"
