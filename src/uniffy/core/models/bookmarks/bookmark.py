"""Bookmark model for user-scoped content bookmarks."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import ContentType, generate_id


class Bookmark(SQLModel, table=True):
    """A user-scoped bookmark on any URN within an organization.

    ``urn`` is always the canonical spelling built from ``(content_type, content_id)``;
    storing a client string verbatim would let UUID aliases slip past the unique
    constraint and register the same content twice.
    """

    __tablename__ = "bookmarks"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "urn",
            name="uq_bookmarks_user_org_urn",
        ),
        Index(
            "ix_bookmarks_user_org_created_id",
            "user_id",
            "organization_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_bookmarks_user_org_type_created_id",
            "user_id",
            "organization_id",
            "content_type",
            "created_at",
            "id",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    urn: str = Field(max_length=500, nullable=False, index=True)
    content_type: ContentType = Field(nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return f"<Bookmark(id={self.id}, user_id={self.user_id}, urn={self.urn!r})>"
