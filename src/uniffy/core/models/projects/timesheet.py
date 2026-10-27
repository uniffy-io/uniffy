"""Timesheet and period models: approval state per person and period, closures per period."""

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, Index, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class TimePeriodStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"


class TimesheetStatus(StrEnum):
    OPEN = "open"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


class TimePeriod(SQLModel, table=True):
    """A row exists only once an admin closes the period; open periods come from the policy."""

    __tablename__ = "projects_time_periods"
    __table_args__ = (
        UniqueConstraint("organization_id", "start_date", name="uq_projects_time_periods_start"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    start_date: date = Field(sa_column=Column(Date, nullable=False))
    end_date: date = Field(sa_column=Column(Date, nullable=False))
    status: TimePeriodStatus = Field(
        default=TimePeriodStatus.CLOSED, sa_column=Column(String(20), nullable=False)
    )
    closed_by_user_id: UUID | None = Field(default=None, foreign_key="login_users.id")
    closed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
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


class Timesheet(SQLModel, table=True):
    """Created on the first state change; a person with no row has an open sheet."""

    __tablename__ = "projects_timesheets"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "user_id", "period_start", name="uq_projects_timesheets_person"
        ),
        Index("ix_projects_timesheets_org_period", "organization_id", "period_start"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    period_start: date = Field(sa_column=Column(Date, nullable=False))
    period_end: date = Field(sa_column=Column(Date, nullable=False))
    status: TimesheetStatus = Field(
        default=TimesheetStatus.OPEN, sa_column=Column(String(20), nullable=False)
    )
    submitted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    # NULL on a submitted sheet means the period job submitted it.
    submitted_by_user_id: UUID | None = Field(default=None, foreign_key="login_users.id")
    submit_comment: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    # The reviewer the person sent the sheet to; unset means every reviewer hears about it.
    submitted_to_user_id: UUID | None = Field(default=None, foreign_key="login_users.id")
    reviewer_user_id: UUID | None = Field(default=None, foreign_key="login_users.id")
    reviewed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    review_comment: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    # While in the future, the person's days in this period accept edits again.
    grace_until: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
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
