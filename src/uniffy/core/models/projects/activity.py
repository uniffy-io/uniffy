"""Activity/comment model for project task history."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskActivity(SQLModel, table=True):
    """
    Activity entry for a task (changes, comments).

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    task_id : UUID
        Task this activity belongs to.
    actor_id : UUID
        User who performed the action.
    action : str
        Action type (created, status_changed, etc.).
    field_id : str | None
        Field ID if this is a field update.
    previous_value : str | None
        Previous value for field updates.
    new_value : str | None
        New value for field updates.
    timestamp : datetime
        When this activity occurred.

    """

    __tablename__ = "projects_activities"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    task_id: UUID = Field(
        foreign_key="projects_tasks.id", nullable=False, index=True
    )
    actor_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    action: str = Field(max_length=50, nullable=False)
    field_id: str | None = Field(default=None, max_length=100)
    previous_value: str | None = Field(default=None)
    new_value: str | None = Field(default=None)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
