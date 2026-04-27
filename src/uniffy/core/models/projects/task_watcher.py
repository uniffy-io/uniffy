"""TaskWatcher model for user task subscriptions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskWatcher(SQLModel, table=True):
    """
    TaskWatcher model representing a user watching a task.

    Watchers receive notifications when the watched task changes
    (status, assignees, completion). Each user can watch a task
    once within an organization.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    user_id : UUID
        User watching the task.
    organization_id : UUID
        Organization context.
    task_id : UUID
        Task being watched.
    created_at : datetime
        When the watch was created.

    """

    __tablename__ = "projects_task_watchers"
    __table_args__ = (UniqueConstraint("user_id", "task_id", name="uq_task_watchers_user_task"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    task_id: UUID = Field(foreign_key="projects_tasks.id", nullable=False, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
