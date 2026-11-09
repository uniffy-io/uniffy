"""A Uniffy change waiting to reach a provider calendar; the row is the durable outbox."""

from datetime import date, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, text
from sqlmodel import Field, SQLModel

from uniffy.core.models.calendar.columns import text_enum, utc_now
from uniffy.core.types import generate_id

MAX_PUSH_ATTEMPTS = 8


class PushOperation(StrEnum):
    UPSERT = "UPSERT"
    DELETE = "DELETE"
    RSVP = "RSVP"
    UPSERT_OCCURRENCE = "UPSERT_OCCURRENCE"
    DELETE_OCCURRENCE = "DELETE_OCCURRENCE"


class PushState(StrEnum):
    PENDING = "PENDING"
    IN_FLIGHT = "IN_FLIGHT"
    DONE = "DONE"
    CONFLICT_RESOLVED = "CONFLICT_RESOLVED"
    FAILED = "FAILED"


class CalendarProviderPush(SQLModel, table=True):
    """One pending write; repeated edits of the same event coalesce into the PENDING row."""

    __tablename__ = "calendar_provider_pushes"
    __table_args__ = (
        Index(
            "uq_calendar_provider_pushes_pending",
            "event_id",
            "connected_calendar_id",
            "operation",
            text("coalesce(occurrence_date, '1970-01-01'::date)"),
            unique=True,
            postgresql_where=text("state = 'PENDING'"),
        ),
        Index("ix_calendar_provider_pushes_due", "state", "next_attempt_at"),
        Index("ix_calendar_provider_pushes_connected_calendar_id", "connected_calendar_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    # No foreign key: a delete must outlive the event it removes.
    event_id: UUID = Field(nullable=False, index=True)
    connected_calendar_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_connected_calendars.id", ondelete="CASCADE"), nullable=False
        )
    )
    actor_id: UUID | None = Field(default=None)
    operation: PushOperation = Field(sa_column=Column(text_enum(PushOperation, 30), nullable=False))
    occurrence_date: date | None = Field(default=None, sa_column=Column(Date, nullable=True))
    # Provider event id captured when the event row may already be gone (deletes).
    provider_event_id: str | None = Field(default=None, max_length=500)
    idempotency_key: UUID = Field(default_factory=uuid4, nullable=False)
    state: PushState = Field(
        default=PushState.PENDING, sa_column=Column(text_enum(PushState, 30), nullable=False)
    )
    attempts: int = Field(default=0, nullable=False)
    next_attempt_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    generation: int = Field(nullable=False)
    last_error_code: str | None = Field(default=None, max_length=40)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )
