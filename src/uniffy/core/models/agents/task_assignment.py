"""An agent assigned to a task: the durable admission and lifecycle of its run."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TaskAssignmentStatus(StrEnum):
    # Assigned and held until someone presses Start; never swept.
    WAITING = "waiting"
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"
    SKIPPED = "skipped"
    UNCERTAIN = "uncertain"


# Queued or running: a run exists that a stop must cancel.
ACTIVE_ASSIGNMENT_STATUSES = (TaskAssignmentStatus.PENDING, TaskAssignmentStatus.RUNNING)
# Not finished yet: a stop or a replacement marks these stopped.
OPEN_ASSIGNMENT_STATUSES = (TaskAssignmentStatus.WAITING, *ACTIVE_ASSIGNMENT_STATUSES)
# Ended with a session the person it worked for can follow up on.
ENDED_ASSIGNMENT_STATUSES = (
    TaskAssignmentStatus.COMPLETED,
    TaskAssignmentStatus.FAILED,
    TaskAssignmentStatus.STOPPED,
    TaskAssignmentStatus.UNCERTAIN,
)


class TaskAssignmentReason(StrEnum):
    TASK = "task"
    PROJECT = "project"


class AgentTaskAssignment(SQLModel, table=True):
    __tablename__ = "agents_task_assignments"
    __table_args__ = (
        # One agent per task: the current row is the task's agent assignee.
        Index(
            "uq_agents_task_assignments_current",
            "task_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        Index(
            "ix_agents_task_assignments_due",
            "available_at",
            postgresql_where=text("status IN ('pending', 'running')"),
        ),
        Index("ix_agents_task_assignments_task", "task_id", "created_at"),
        Index("ix_agents_task_assignments_agent_current", "agent_id", "is_current"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", ondelete="CASCADE")
    task_id: UUID = Field(foreign_key="projects_tasks.id", ondelete="CASCADE")
    agent_id: UUID = Field(foreign_key="agents_agents.id", ondelete="CASCADE")
    # The run executes with this person's permissions.
    assigned_by: UUID = Field(foreign_key="login_users.id", ondelete="CASCADE")
    reason: TaskAssignmentReason = Field(sa_column=Column(String(24), nullable=False))
    status: TaskAssignmentStatus = Field(
        default=TaskAssignmentStatus.PENDING, sa_column=Column(String(24), nullable=False)
    )
    is_current: bool = Field(default=True)
    session_id: UUID | None = Field(
        default=None, foreign_key="agents_sessions.id", ondelete="SET NULL"
    )
    run_id: UUID = Field(default_factory=generate_id)
    # The person's review of an earlier run on the same session; the user turn of this run.
    change_request: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    last_error: str | None = Field(default=None, max_length=200)
    dispatches: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    available_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # When the person chose to start it; the delivery refuses to start any earlier.
    start_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    ended_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
