"""A member's standing permission for a colleague to run their calendar."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, Enum, ForeignKey, Index, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CalendarDelegationLevel(StrEnum):
    # EVENTS leaves private events busy-only unless the delegate is invited to them.
    EVENTS = "EVENTS"
    EVENTS_AND_PRIVATE = "EVENTS_AND_PRIVATE"


class CalendarDelegation(SQLModel, table=True):
    """The grantor lets the delegate act on their personal calendars on their behalf."""

    __tablename__ = "calendar_delegations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "grantor_id", "delegate_id", name="uq_calendar_delegations_pair"
        ),
        Index("ix_calendar_delegations_delegate", "organization_id", "delegate_id"),
        Index("ix_calendar_delegations_created", "organization_id", "created_at", "id"),
        CheckConstraint("grantor_id <> delegate_id", name="ck_calendar_delegations_not_self"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    grantor_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), nullable=False),
    )
    delegate_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), nullable=False),
    )
    level: CalendarDelegationLevel = Field(
        default=CalendarDelegationLevel.EVENTS,
        sa_column=Column(
            Enum(
                CalendarDelegationLevel,
                name="calendardelegationlevel",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    created_by_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
