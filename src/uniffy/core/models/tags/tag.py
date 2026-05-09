"""SQLModel definitions for tags and tag assignments.

The ``tags`` table is the per-organization tag namespace. The
``tag_assignments`` table is the polymorphic link between a tag and an
arbitrary URN-addressable content row. ``sources`` is a string array so
a tag attached both via the manual picker and via inline markdown lives
in a single row instead of two.

There is no denormalized ``usage_count`` column. Counts are computed
from ``tag_assignments`` and cached in Valkey to avoid row-lock
contention on hot tags.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Tag(SQLModel, table=True):
    """A single tag in an organization's tag namespace."""

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_tags_org_slug"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    name: str = Field(max_length=120, nullable=False)
    slug: str = Field(max_length=64, nullable=False)
    color: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)
    created_by: UUID | None = Field(
        default=None, foreign_key="login_users.id", nullable=True, index=True
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    @property
    def urn(self) -> str:
        """URN representation used by mention chips and search."""
        return f"urn:uniffy:content:TAG:{self.id}"

    def __repr__(self) -> str:
        return f"<Tag(id={self.id}, slug={self.slug!r}, org={self.organization_id})>"


class TagAssignment(SQLModel, table=True):
    """Many-to-one link from a tag to a URN-addressable content row."""

    __tablename__ = "tag_assignments"

    tag_id: UUID = Field(
        sa_column=Column(
            ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    content_urn: str = Field(
        sa_column=Column(String(500), primary_key=True, nullable=False),
    )
    content_type: str = Field(max_length=64, nullable=False)
    sources: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String(16)), nullable=False, server_default="{}"),
    )
    assigned_by: UUID | None = Field(
        default=None, foreign_key="login_users.id", nullable=True
    )
    assigned_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<TagAssignment(tag_id={self.tag_id}, urn={self.content_urn!r}, "
            f"sources={self.sources})>"
        )
