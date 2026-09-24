"""View configuration model for project views."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ProjectViewType(StrEnum):
    TABLE = "table"
    BOARD = "board"
    ROADMAP = "roadmap"
    BACKLOG = "backlog"
    GRAPH = "graph"
    RESOURCES = "resources"


class ProjectViewVisibility(StrEnum):
    PERSONAL = "PERSONAL"
    SHARED = "SHARED"


class DefaultProjectViewId(StrEnum):
    TABLE = "view_table"
    BOARD = "view_board"
    ROADMAP = "view_roadmap"
    BACKLOG = "view_backlog"
    GRAPH = "view_graph"
    RESOURCES = "view_resources"


class ViewConfig(SQLModel, table=True):
    """Named view (table, board, roadmap, etc.) on a project, personal to its owner or shared.

    Composite PK `(id, project_id)` so fixed ids like `view_table` repeat across projects.
    """

    __tablename__ = "projects_views"
    __table_args__ = (Index("ix_projects_views_scope", "project_id", "visibility", "owner_id"),)

    id: str = Field(primary_key=True, max_length=100, nullable=False)
    project_id: UUID = Field(
        primary_key=True, foreign_key="projects_projects.id", nullable=False, index=True
    )
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    name: str = Field(max_length=255, nullable=False)
    type: ProjectViewType = Field(sa_column=Column(String(50), nullable=False))
    visibility: ProjectViewVisibility = Field(
        sa_column=Column(
            Enum(
                ProjectViewVisibility,
                name="projectviewvisibility",
                values_callable=lambda enum: [member.value for member in enum],
            ),
            nullable=False,
        ),
    )
    sort_order: int = Field(default=0, nullable=False)
    definition: dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
