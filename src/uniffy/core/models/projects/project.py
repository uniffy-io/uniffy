"""Project model for the projects feature."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class Project(SQLModel, table=True):
    """
    Project model representing a project/workspace for tasks.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    organization_id : UUID
        Organization this project belongs to.
    owner_id : UUID
        User who created/owns the project.
    access_mode : AccessMode
        How access to this project is governed.
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    name : str
        Project name (max 255 chars).
    description : str
        Project description (Markdown).
    icon : str
        Icon identifier (e.g., "rocket", "megaphone").
    color : str
        Hex color code (e.g., "#3b82f6").
    slug : str
        Short uppercase identifier used for task IDs (e.g., "UAI").
    task_counter : int
        Monotonically increasing counter for task number generation.
    default_view_id : str | None
        ID of the default view.
    is_deleted : bool
        Soft delete flag.
    version : int
        Optimistic locking version.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.
    deleted_at : datetime | None
        Soft delete timestamp.

    """

    __tablename__ = "projects_projects"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    access_mode: AccessMode = Field(
        default=AccessMode.OPEN_TO_ORG,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=ContentRole.EDITOR,
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
    name: str = Field(max_length=255, nullable=False)
    description: str = Field(default="", nullable=False)
    icon: str = Field(default="folder", max_length=50, nullable=False)
    color: str = Field(default="#3b82f6", max_length=20, nullable=False)
    slug: str = Field(max_length=20, nullable=False)
    task_counter: int = Field(default=0, nullable=False)
    default_view_id: str | None = Field(default=None, max_length=100)
    type_field_schemas: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    is_deleted: bool = Field(default=False, nullable=False)
    version: int = Field(default=1, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    @property
    def urn(self) -> str:
        """Return the URN for this project."""
        return f"urn:uniffy:content:PROJECT:{self.id}"
