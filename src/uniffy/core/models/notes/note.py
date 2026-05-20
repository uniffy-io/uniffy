"""Note model for the notes feature."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, NodeType, generate_id


class Note(SQLModel, table=True):
    """
    Note model representing a note in the system.

    Notes are organization-scoped and can be linked to other notes using wiki-links.
    Supports markdown content, backlinks, and full-text search.

    Attributes
    ----------
    id : UUID
        Unique identifier for the note (primary key).
    organization_id : UUID
        Organization this note belongs to (foreign key).
    owner_id : UUID
        User who owns the note (foreign key to login_users).
    access_mode : AccessMode
        How access to this note is governed (OWNER_ONLY, OPEN_TO_ORG, MEMBERS_ONLY).
    baseline_role : ContentRole | None
        Default role granted by the access mode (e.g. VIEWER, EDITOR).
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
    note_metadata : dict | None
        Additional metadata (custom fields, AI-generated summaries, etc).
    outgoing_references : list[str] | None
        List of URNs referenced in this note (e.g. ["urn:uniffy:file:123", ...]).
    created_at : datetime
        Timestamp when the note was created.
    updated_at : datetime
        Timestamp when the note was last updated.
    deleted_at : datetime | None
        Timestamp when the note was soft-deleted.

    Note: Bookmark status is managed by the BookmarksService (user-scoped).

    """

    __tablename__ = "notes_notes"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
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
    canvas_content: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    slug: str = Field(max_length=500, nullable=False, index=True)
    is_deleted: bool = Field(default=False, nullable=False)
    version: int = Field(default=1, nullable=False)
    parent_id: UUID | None = Field(default=None, foreign_key="notes_notes.id", index=True)
    note_metadata: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    outgoing_references: list[str] | None = Field(default=None, sa_column=Column(JSONB))
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
            f"access_mode={self.access_mode}, organization_id={self.organization_id})>"
        )
