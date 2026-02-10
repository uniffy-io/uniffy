"""User session model for tracking login sessions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class UserSession(SQLModel, table=True):
    """
    Tracks individual login sessions for a user.

    Each login creates a session record. Sessions can be individually
    revoked without affecting other sessions. This enables the user to
    see where they are logged in and selectively terminate logins.

    Attributes
    ----------
    id : UUID
        Unique session identifier (UUIDv7).
    user_id : UUID
        Foreign key to the user.
    ip_address : str
        Client IP at login time.
    user_agent : str
        Raw User-Agent header from the client.
    device_label : str
        Human-readable device description (e.g. "Chrome on macOS").
    created_at : datetime
        When the session was created.
    last_activity : datetime
        When the session was last used (updated on token refresh).
    is_revoked : bool
        Whether this session has been revoked.
    revoked_at : datetime | None
        When the session was revoked (if applicable).

    """

    __tablename__ = "login_user_sessions"
    __table_args__ = (
        Index("ix_login_user_sessions_user_id", "user_id"),
        Index("ix_login_user_sessions_user_id_active", "user_id", "is_revoked"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(
        sa_column_kwargs={"type_": None},
        foreign_key="login_users.id",
        nullable=False,
    )
    ip_address: str = Field(max_length=45, nullable=False, default="")
    user_agent: str = Field(max_length=512, nullable=False, default="")
    device_label: str = Field(max_length=255, nullable=False, default="")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_activity: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    is_revoked: bool = Field(default=False, nullable=False)
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UserSession(id={self.id}, user_id={self.user_id}, device={self.device_label})>"
