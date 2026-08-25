"""Note model for the notes feature."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, NodeType, generate_id


class Note(SQLModel, table=True):
    """An org-scoped markdown or canvas note with extracted outgoing URN references."""

    __tablename__ = "notes_notes"
    __table_args__ = (
        Index("ix_notes_notes_parent_id_is_deleted", "parent_id", "is_deleted"),
        Index(
            "ix_notes_notes_org_updated_refs",
            "organization_id",
            "updated_at",
            postgresql_where=text("is_deleted = false AND outgoing_references IS NOT NULL"),
        ),
    )

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
        return (
            f"<Note(id={self.id}, title={self.title!r}, "
            f"access_mode={self.access_mode}, organization_id={self.organization_id})>"
        )
