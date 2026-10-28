"""Worklog model: one person's time on one task on one calendar day."""

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, Index, String, Text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class WorklogSource(StrEnum):
    MANUAL = "manual"
    TIMER = "timer"
    IMPORT = "import"
    AGENT = "agent"


class Worklog(SQLModel, table=True):
    """A task's time spent is the sum of its live rows; soft delete keeps the trail."""

    __tablename__ = "projects_worklogs"
    __table_args__ = (
        Index("ix_projects_worklogs_org_user_date", "organization_id", "user_id", "work_date"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    task_id: UUID = Field(foreign_key="projects_tasks.id", nullable=False, index=True)
    # Whose time this is.
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    # Who logged it; differs from user_id on an on-behalf entry.
    created_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    # The worker's calendar day, chosen by the client in the person's own zone.
    work_date: date = Field(sa_column=Column(Date, nullable=False))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    # Bounds are enforced in the operations for new entries; imported history is exempt.
    duration_minutes: int = Field(nullable=False)
    description: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    source: WorklogSource = Field(
        default=WorklogSource.MANUAL,
        sa_column=Column(String(20), nullable=False),
    )
    is_deleted: bool = Field(default=False, nullable=False)
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
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
