"""Subscribe-feed tokens for calendars.

One row per (calendar, subscriber). The raw token lives in the URL a calendar
client polls, so it is stored twice: a SHA256 digest to look it up by, and an
``OrgCipher`` envelope so the owner can read their own URL back on a second
device without invalidating the first. A database leak alone yields neither,
and ``OrgCipher`` refuses to decrypt under an active support session, so a
platform operator cannot lift a subscriber's feed URL.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CalendarFeedToken(SQLModel, table=True):
    """A read-only subscription to one person's view of one calendar."""

    __tablename__ = "calendar_feed_tokens"
    __table_args__ = (
        UniqueConstraint("calendar_id", "user_id", name="uq_calendar_feed_tokens_calendar_user"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    calendar_id: UUID = Field(foreign_key="calendar_calendars.id", nullable=False, index=True)
    user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
        description="Whose view the feed renders; the token never widens it.",
    )
    token_hash: str = Field(
        sa_column=Column(String(64), nullable=False, unique=True, index=True),
        description="SHA256 hex digest of the raw token, which the lookup matches on.",
    )
    token_encrypted: str = Field(
        sa_column=Column(Text, nullable=False),
        description="OrgCipher envelope of the raw token, so the owner can re-read the URL.",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
        description="Last successful fetch, so a stale subscription is visible in the UI.",
    )
