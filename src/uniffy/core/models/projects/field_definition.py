"""Field definition model for project custom fields."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ProjectFieldType(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    SINGLE_SELECT = "single_select"
    MULTI_SELECT = "multi_select"
    DATE = "date"
    PERSON = "person"
    REFERENCE = "reference"


class SystemProjectFieldId(StrEnum):
    TITLE = "field_title"
    STATUS = "field_status"
    PRIORITY = "field_priority"
    ASSIGNEE = "field_assignee"
    START_DATE = "field_start_date"
    DUE_DATE = "field_due_date"
    TYPE = "field_type"


class TaskStatusSemantic(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    COMPLETED = "completed"


class DefaultTaskStatusId(StrEnum):
    TODO = "status_todo"
    IN_PROGRESS = "status_in_progress"
    REVIEW = "status_review"
    COMPLETED = "status_done"


class FieldDefinition(SQLModel, table=True):
    """System or custom field on a project.

    Composite PK `(id, project_id)` lets fixed system ids like `field_title`
    repeat across projects.
    """

    __tablename__ = "projects_field_definitions"

    id: str = Field(primary_key=True, max_length=100, nullable=False)
    project_id: UUID = Field(
        primary_key=True, foreign_key="projects_projects.id", nullable=False, index=True
    )
    name: str = Field(max_length=255, nullable=False)
    type: ProjectFieldType = Field(
        sa_column=Column(String(50), nullable=False),
    )
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
