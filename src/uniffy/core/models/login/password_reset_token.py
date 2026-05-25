"""Password reset token table.

Single-use, expiring tokens. The raw token (32 url-safe bytes) lives
only in the user's mailbox and the URL; the database stores the SHA256
hex digest so a database leak cannot be replayed to reset passwords.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class PasswordResetToken(SQLModel, table=True):
    """One row per reset request; ``used_at`` enforces single-use."""

    __tablename__ = "login_password_reset_tokens"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    token_hash: str = Field(
        sa_column=Column(String(64), nullable=False, unique=True, index=True),
        description="SHA256 hex digest of the raw token; raw token never persisted.",
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    requested_ip: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
