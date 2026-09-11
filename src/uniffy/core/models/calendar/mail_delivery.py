"""Pending event mail, the durable fact behind the delivery job."""

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, Enum, Index, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CalendarMailKind(StrEnum):
    INVITATION = "INVITATION"
    CHANGE = "CHANGE"
    CANCELLATION = "CANCELLATION"


class CalendarMailStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


class CalendarMailDelivery(SQLModel, table=True):
    """One message owed to one recipient about one event.

    The row is written inside the mutation's transaction, so a send that never
    happens stays recoverable. While it is PENDING a partial unique index keeps
    a burst of edits collapsed onto this single row.
    """

    __tablename__ = "calendar_mail_deliveries"
    __table_args__ = (
        Index(
            "ix_calendar_mail_deliveries_due",
            "scheduled_for",
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    event_id: UUID = Field(foreign_key="calendar_events.id", nullable=False, index=True)
    recipient_user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    actor_user_id: UUID | None = Field(default=None, foreign_key="login_users.id")
    kind: CalendarMailKind = Field(
        sa_column=Column(
            Enum(
                CalendarMailKind,
                name="calendarmailkind",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        )
    )
    status: CalendarMailStatus = Field(
        default=CalendarMailStatus.PENDING,
        sa_column=Column(
            Enum(
                CalendarMailStatus,
                name="calendarmailstatus",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    # Set only when one occurrence is cancelled rather than the whole series.
    occurrence_date: date | None = Field(default=None, sa_column=Column(Date, nullable=True))
    scheduled_for: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    attempts: int = Field(default=0, nullable=False)
    last_error: str | None = Field(default=None, max_length=1000)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<CalendarMailDelivery(id={self.id}, event_id={self.event_id}, "
            f"kind={self.kind}, status={self.status})>"
        )
