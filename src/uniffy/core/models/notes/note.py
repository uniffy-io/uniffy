"""Note model for the notes feature."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum, text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import NodeType, VisibilityScope


class Note(SQLModel, table=True):
    """
    Note model representing a note in the system.

    Notes are organization-scoped and can be linked to other notes using wiki-links.
    Supports markdown content, backlinks, and full-text search.

    Content Visibility:
    - PRIVATE: Personal space - only owner can access
    - GROUP: Shared with specific group(s) via ContentGroupLink
    - ORGANIZATION: Accessible to all organization members
    - PUBLIC: Accessible externally (future feature)

    Attributes
    ----------
    id : UUID
        Unique identifier for the note (primary key).
    organization_id : UUID
        Organization this note belongs to (foreign key).
    owner_id : UUID
        User who owns the note (foreign key to login_users).
    visibility : VisibilityScope
        Who can access this note (PRIVATE, GROUP, ORGANIZATION, PUBLIC).
    node_type : NodeType
        Type of node (NOTE, FOLDER, TEMPLATE).
    title : str
        Note title (max 500 chars).
    content : str
        Note content in markdown format.
    slug : str
        URL-friendly slug, unique within organization.
    is_deleted : bool
        Soft delete flag.
    version : int
        Version number for optimistic locking and conflict resolution.
    parent_id : UUID | None
        Parent note ID for hierarchical organization (nullable).
    tags : list[str] | None
        Tags for categorization.
    note_metadata : dict | None
        Additional metadata (custom fields, AI-generated summaries, etc).
    outgoing_references : list[str] | None
        List of URNs referenced in this note (e.g. ["urn:uniffy:file:123", ...]).
    content_search : Any
        Full-text search vector (managed by database trigger).
    created_at : datetime
        Timestamp when the note was created.
    updated_at : datetime
        Timestamp when the note was last updated.
    deleted_at : datetime | None
        Timestamp when the note was soft-deleted.

    Note: Bookmark status is managed by the BookmarksService (user-scoped).

    """

    __tablename__ = "notes_notes"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    visibility: VisibilityScope = Field(
        default=VisibilityScope.PRIVATE,
        sa_column=Column(
            Enum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
            index=True,
        ),
    )
    node_type: NodeType = Field(
        default=NodeType.NOTE,
        sa_column=Column(
            Enum(NodeType, name="nodetype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
            index=True,
        ),
    )
    title: str = Field(max_length=500, nullable=False)
    content: str = Field(default="", nullable=False)
    slug: str = Field(max_length=500, nullable=False, index=True)
    is_deleted: bool = Field(default=False, nullable=False)
    version: int = Field(default=1, nullable=False)
    parent_id: UUID | None = Field(default=None, foreign_key="notes_notes.id", index=True)
    tags: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    note_metadata: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    outgoing_references: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    content_search: Any = Field(
        default=None,
        sa_column=Column(
            TSVECTOR,
            nullable=True,
            server_default=text("to_tsvector('english', '')"),
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    def __repr__(self) -> str:
        """Return string representation of Note."""
        return (
            f"<Note(id={self.id}, title={self.title!r}, "
            f"visibility={self.visibility}, organization_id={self.organization_id})>"
        )
