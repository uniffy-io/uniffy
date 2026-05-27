"""View configuration model for project views."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ViewConfig(SQLModel, table=True):
    """Named view (table, board, roadmap, etc.) on a project.

    Composite PK `(id, project_id)` so fixed ids like `view_table` repeat across projects.
    """

    __tablename__ = "projects_views"

    id: str = Field(primary_key=True, max_length=100, nullable=False)
    project_id: UUID = Field(
        primary_key=True, foreign_key="projects_projects.id", nullable=False, index=True
    )
    name: str = Field(max_length=255, nullable=False)
    type: str = Field(max_length=50, nullable=False)
    is_default: bool = Field(default=False, nullable=False)
    config: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
