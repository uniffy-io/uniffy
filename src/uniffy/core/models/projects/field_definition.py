"""Field definition model for project custom fields."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class FieldDefinition(SQLModel, table=True):
    """
    Field definition for a project.

    System fields (title, status, priority, assignee, dates) are created
    automatically when a project is created. Custom fields can be added
    by project admins.

    Uses a composite primary key (id, project_id) so that system field IDs
    like "field_title" can be reused across projects.

    Attributes
    ----------
    id : str
        Field identifier (part of composite PK).
    project_id : UUID
        Project this field belongs to (part of composite PK).
    name : str
        Field display name.
    type : str
        Field type (text, number, single_select, etc.).
    is_required : bool
        Whether this field is required.
    is_system : bool
        Whether this is a system field (cannot be deleted).
    sort_order : int
        Display order.
    config : dict[str, Any] | None
        Field configuration (e.g., select options).
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "projects_field_definitions"

    id: str = Field(primary_key=True, max_length=100, nullable=False)
    project_id: UUID = Field(
        primary_key=True, foreign_key="projects_projects.id", nullable=False, index=True
    )
    name: str = Field(max_length=255, nullable=False)
    type: str = Field(max_length=50, nullable=False)
    is_required: bool = Field(default=False, nullable=False)
    is_system: bool = Field(default=False, nullable=False)
    sort_order: int = Field(default=0, nullable=False)
    config: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
