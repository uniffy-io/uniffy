"""Bookmark model for user-scoped content bookmarks."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel


class Bookmark(SQLModel, table=True):
    """
    Bookmark model representing a user's bookmarked content.

    Bookmarks are user-scoped (personal) and organization-scoped.
    Each user can bookmark any URN once within an organization.

    Attributes
    ----------
    id : UUID
        Unique identifier for the bookmark (primary key).
    user_id : UUID
        User who created the bookmark (foreign key to login_users).
    organization_id : UUID
        Organization context (foreign key to login_organizations).
    urn : str
        URN of the bookmarked content (e.g., "urn:uwos:content:NOTE:uuid").
    created_at : datetime
        Timestamp when the bookmark was created.

    """

    __tablename__ = "bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "urn", name="uq_bookmarks_user_urn"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    urn: str = Field(max_length=500, nullable=False, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of Bookmark."""
        return f"<Bookmark(id={self.id}, user_id={self.user_id}, urn={self.urn!r})>"
