"""Single-use MFA recovery codes.

Ten rows generated per user at ``ConfirmEnrollment`` (and again on
``RegenerateRecoveryCodes``). Each ``code_hash`` is an Argon2id hash of
the plaintext code; the plaintext is shown to the user exactly once and
never persisted. ``used_at`` flips on first successful verify -- the
partial index ``WHERE used_at IS NULL`` keeps the active-set scan
linear in unused codes only.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class UserRecoveryCode(SQLModel, table=True):
    """One Argon2id-hashed recovery code belonging to a user."""

    __tablename__ = "login_user_recovery_codes"
    __table_args__ = (
        Index(
            "ix_login_user_recovery_codes_user_active",
            "user_id",
            postgresql_where=text("used_at IS NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
    )
    code_hash: str = Field(
        sa_column=Column(Text, nullable=False),
        description="Argon2id hash of the plaintext recovery code.",
    )
    used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
        description="Null = active. Stamped on first successful verify.",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
