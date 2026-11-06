"""A person's subscription to an external iCalendar feed, mirrored into one calendar."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id

MIN_REFRESH_INTERVAL_MINUTES = 15
DEFAULT_REFRESH_INTERVAL_MINUTES = 60


class SubscriptionFailure(StrEnum):
    """Why the last refresh failed; stored as text so a new reason needs no migration."""

    INVALID_URL = "INVALID_URL"
    UNRESOLVABLE = "UNRESOLVABLE"
    BLOCKED_ADDRESS = "BLOCKED_ADDRESS"
    UNREACHABLE = "UNREACHABLE"
    TIMEOUT = "TIMEOUT"
    HTTP_STATUS = "HTTP_STATUS"
    TOO_LARGE = "TOO_LARGE"
    REDIRECT_REFUSED = "REDIRECT_REFUSED"
    TOO_MANY_REDIRECTS = "TOO_MANY_REDIRECTS"
    NOT_A_CALENDAR = "NOT_A_CALENDAR"
    TOO_MANY_EVENTS = "TOO_MANY_EVENTS"
    POLICY_DISABLED = "POLICY_DISABLED"
    # The feed was fetched but storing it failed; the row backs off like any failure.
    UNPROCESSABLE = "UNPROCESSABLE"


class CalendarSubscription(SQLModel, table=True):
    """The feed behind a SUBSCRIBED calendar; the address is a secret, so only its host is shown."""

    __tablename__ = "calendar_subscriptions"
    __table_args__ = (
        CheckConstraint(
            f"refresh_interval_minutes >= {MIN_REFRESH_INTERVAL_MINUTES}",
            name="ck_calendar_subscriptions_interval",
        ),
        Index("ix_calendar_subscriptions_due", "next_refresh_at"),
        Index(
            "uq_calendar_subscriptions_owner_url",
            "organization_id",
            "owner_id",
            "url_digest",
            unique=True,
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    calendar_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_calendars.id", ondelete="CASCADE"), nullable=False, unique=True
        )
    )
    url_encrypted: str = Field(sa_column=Column(Text, nullable=False))
    url_digest: str = Field(sa_column=Column(String(64), nullable=False))
    url_host: str = Field(max_length=255, nullable=False)
    refresh_interval_minutes: int = Field(default=DEFAULT_REFRESH_INTERVAL_MINUTES, nullable=False)
    counts_as_busy: bool = Field(default=False, nullable=False)
    etag: str | None = Field(default=None, max_length=500)
    last_modified: str | None = Field(default=None, max_length=100)
    content_digest: str | None = Field(default=None, max_length=64)
    next_refresh_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    last_attempt_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    last_success_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    consecutive_failures: int = Field(default=0, nullable=False)
    last_error_code: SubscriptionFailure | None = Field(
        default=None, sa_column=Column(String(40), nullable=True)
    )
    last_error_status: int | None = Field(default=None)
    failure_notified_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    event_count: int = Field(default=0, nullable=False)
    skipped_count: int = Field(default=0, nullable=False)
    # Set with every sync that changes events and cleared once search holds them,
    # so a refresh that could not reach search is repaired by the next one.
    search_stale: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
