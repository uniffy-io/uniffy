"""Task model for the projects feature."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import VisibilityScope
from uniffy.core.types import generate_id


class Task(SQLModel, table=True):
    """
    Task model representing a task within a project.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    project_id : UUID
        Project this task belongs to.
    organization_id : UUID
        Organization scope.
    owner_id : UUID
        User who created the task.
    visibility : VisibilityScope
        Inherited from project (denormalized for permission queries).
    title : str
        Task title (max 500 chars).
    description : str
        Markdown description with URN mentions.
    status : str
        Status option ID (e.g., "status_todo").
    priority : str
        Priority option ID (e.g., "priority_high").
    assignee_ids : list[str] | None
        Assigned user IDs.
    start_date : str | None
        ISO date string (calendar date, no time).
    due_date : str | None
        ISO date string (calendar date, no time).
    completed_at : datetime | None
        When the task was completed.
    parent_id : UUID | None
        Parent task ID for subtasks.
    blocked_by_task_ids : list[str] | None
        IDs of tasks that block this task.
    is_milestone : bool
        Milestone flag for roadmap view.
    recurrence_rule : str | None
        RRULE string (RFC 5545).
    sort_order : int
        Ordering within status group.
    field_values : dict | None
        Custom field values as JSONB.
    outgoing_references : list[str] | None
        URNs referenced in description.
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

    __tablename__ = "projects_tasks"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    project_id: UUID = Field(
        foreign_key="projects_projects.id", nullable=False, index=True
    )
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    visibility: VisibilityScope = Field(
        default=VisibilityScope.PRIVATE,
        sa_column=Column(
            Enum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )
    title: str = Field(max_length=500, nullable=False)
    description: str = Field(default="", nullable=False)
    status: str = Field(
        default="status_todo", max_length=100, nullable=False, index=True
    )
    priority: str = Field(default="priority_medium", max_length=100, nullable=False)
    assignee_ids: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    start_date: str | None = Field(default=None, max_length=20)
    due_date: str | None = Field(default=None, max_length=20)
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    parent_id: UUID | None = Field(
        default=None, foreign_key="projects_tasks.id", index=True
    )
    blocked_by_task_ids: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    is_milestone: bool = Field(default=False, nullable=False)
    recurrence_rule: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    field_values: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    outgoing_references: list[str] | None = Field(
        default=None, sa_column=Column(JSONB)
    )
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
    deleted_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )

    @property
    def urn(self) -> str:
        """Return the URN for this task."""
        return f"urn:uniffy:content:TASK:{self.id}"
