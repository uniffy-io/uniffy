"""Bookmark model for user-scoped content bookmarks."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Bookmark(SQLModel, table=True):
    """A user-scoped bookmark on any URN within an organization."""

    __tablename__ = "bookmarks"
    __table_args__ = (UniqueConstraint("user_id", "urn", name="uq_bookmarks_user_urn"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    urn: str = Field(max_length=500, nullable=False, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return f"<Bookmark(id={self.id}, user_id={self.user_id}, urn={self.urn!r})>"
