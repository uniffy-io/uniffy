"""Timer model: the one running or paused timer a person has per organization."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TimerPauseReason(StrEnum):
    # Paused by the overrun job once the elapsed time passed the org limit.
    LIMIT = "limit"


class Timer(SQLModel, table=True):
    """Elapsed is accumulated_seconds plus the running segment since started_at."""

    __tablename__ = "projects_timers"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_projects_timers_org_user"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    task_id: UUID = Field(foreign_key="projects_tasks.id", nullable=False, index=True)
    description: str = Field(default="", nullable=False)
    # Start of the running segment; NULL while paused.
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    accumulated_seconds: int = Field(default=0, nullable=False)
    paused_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    pause_reason: TimerPauseReason | None = Field(
        default=None, sa_column=Column(String(20), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), nullable=False, onupdate=lambda: datetime.now(UTC)
        ),
    )
