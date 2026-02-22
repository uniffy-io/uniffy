"""Sprint model for the projects feature."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Sprint(SQLModel, table=True):
    """
    Sprint model representing a time-boxed iteration within a project.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    project_id : UUID
        Project this sprint belongs to.
    organization_id : UUID
        Organization scope.
    name : str
        Sprint name (max 255 chars).
    goal : str
        Sprint goal description.
    status : str
        Sprint status: planned, active, or closed.
    start_date : str | None
        ISO date string for sprint start.
    end_date : str | None
        ISO date string for sprint end.
    sort_order : int
        Ordering among sprints in the project.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "projects_sprints"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    project_id: UUID = Field(
        foreign_key="projects_projects.id", nullable=False, index=True
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    name: str = Field(max_length=255, nullable=False)
    goal: str = Field(default="", nullable=False)
    status: str = Field(default="planned", max_length=20, nullable=False)
    start_date: str | None = Field(default=None, max_length=20)
    end_date: str | None = Field(default=None, max_length=20)
    sort_order: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
