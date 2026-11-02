"""Activity/comment model for project task history."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskActivityAction(StrEnum):
    CREATED = "created"
    TITLE_CHANGED = "title_changed"
    DESCRIPTION_EDITED = "description_edited"
    STATUS_CHANGED = "status_changed"
    PRIORITY_CHANGED = "priority_changed"
    TYPE_CHANGED = "type_changed"
    ASSIGNED = "assigned"
    START_DATE_CHANGED = "start_date_changed"
    DUE_DATE_CHANGED = "due_date_changed"
    SPRINT_CHANGED = "sprint_changed"
    ESTIMATE_CHANGED = "estimate_changed"
    PARENT_CHANGED = "parent_changed"
    RECURRENCE_CHANGED = "recurrence_changed"
    MILESTONE_CHANGED = "milestone_changed"
    TAGS_CHANGED = "tags_changed"
    FIELD_UPDATED = "field_updated"
    BLOCKED_BY_ADDED = "blocked_by_added"
    BLOCKED_BY_REMOVED = "blocked_by_removed"
    BLOCKING_ADDED = "blocking_added"
    BLOCKING_REMOVED = "blocking_removed"
    TIME_LOGGED = "time_logged"
    TIME_UPDATED = "time_updated"
    TIME_REMOVED = "time_removed"


class TaskActivity(SQLModel, table=True):
    """Activity entry for a task: status flips, field edits, comments."""

    __tablename__ = "projects_activities"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    task_id: UUID = Field(foreign_key="projects_tasks.id", nullable=False, index=True)
    actor_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    # Set when an agent made the change; actor_id stays the person it acted for.
    agent_id: UUID | None = Field(default=None, foreign_key="agents_agents.id", nullable=True)
    action: str = Field(max_length=50, nullable=False)
    field_id: str | None = Field(default=None, max_length=100)
    previous_value: str | None = Field(default=None)
    new_value: str | None = Field(default=None)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
