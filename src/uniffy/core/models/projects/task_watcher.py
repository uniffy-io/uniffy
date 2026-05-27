"""TaskWatcher model for user task subscriptions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskWatcher(SQLModel, table=True):
    """User subscription to task changes; one row per (user, task)."""

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
