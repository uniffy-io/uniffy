"""User session model for tracking login sessions."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class UserSession(SQLModel, table=True):
    """One login session for a user; revocable independently of other sessions.

    ``refresh_token_hash`` is the SHA256 hex digest of the most-recently-issued
    refresh token for this session. ``previous_refresh_token_hash`` carries the
    immediately-prior digest for a short grace window so concurrent cross-tab
    refreshes do not trip the reuse-detection alarm. A refresh whose digest
    matches neither column is treated as a stolen-token replay: every session
    for the user is revoked and ``token_version`` is bumped.
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
    organization_id: UUID | None = Field(
        default=None,
        sa_column_kwargs={"type_": None},
        foreign_key="login_organizations.id",
        nullable=True,
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
    refresh_token_hash: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    previous_refresh_token_hash: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    previous_refresh_rotated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    def __repr__(self) -> str:
        return f"<UserSession(id={self.id}, user_id={self.user_id}, device={self.device_label})>"
