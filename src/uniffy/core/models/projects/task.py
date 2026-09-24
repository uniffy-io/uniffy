"""Task model for the projects feature."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Integer, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskType(StrEnum):
    TASK = "task"
    BUG = "bug"
    FEATURE = "feature"
    STORY = "story"
    EPIC = "epic"


class Task(SQLModel, table=True):
    """Task within a project. Access policy is inherited from the parent project."""

    __tablename__ = "projects_tasks"
    __table_args__ = (
        Index(
            "ix_projects_tasks_org_updated_refs",
            "organization_id",
            "updated_at",
            postgresql_where=text("is_deleted = false AND outgoing_references IS NOT NULL"),
        ),
        Index("ix_projects_tasks_assignee_ids", "assignee_ids", postgresql_using="gin"),
        Index(
            "ix_projects_tasks_field_values",
            text("field_values jsonb_path_ops"),
            postgresql_using="gin",
        ),
        Index("ix_projects_tasks_project_due_date", "project_id", "due_date"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    project_id: UUID = Field(foreign_key="projects_projects.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    title: str = Field(max_length=500, nullable=False)
    description: str = Field(default="", nullable=False)
    status: str = Field(default="status_todo", max_length=100, nullable=False, index=True)
    priority: str = Field(default="priority_medium", max_length=100, nullable=False)
    assignee_ids: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    start_date: str | None = Field(default=None, max_length=20)
    due_date: str | None = Field(default=None, max_length=20)
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    parent_id: UUID | None = Field(default=None, foreign_key="projects_tasks.id", index=True)
    blocked_by_task_ids: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    is_milestone: bool = Field(default=False, nullable=False)
    recurrence_rule: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    number: int = Field(default=0, nullable=False)
    task_type: str = Field(default="task", max_length=50, nullable=False)
    sprint_id: UUID | None = Field(default=None, foreign_key="projects_sprints.id", index=True)
    estimated_minutes: int | None = Field(default=None, nullable=True)
    time_spent_minutes: int | None = Field(default=None, nullable=True)
    field_values: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    outgoing_references: list[str] | None = Field(default=None, sa_column=Column(JSONB))
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
        return f"urn:uniffy:content:TASK:{self.id}"
