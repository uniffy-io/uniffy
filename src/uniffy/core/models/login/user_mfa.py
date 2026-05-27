"""Per-user MFA state.

One row per :class:`User` that has ever begun TOTP enrollment. The row
is created on ``BeginEnrollment`` with ``enabled=false`` and the
encrypted TOTP secret already present; ``ConfirmEnrollment`` flips
``enabled`` to true and stamps ``enrolled_at``.

The secret is stored as :class:`DeploymentCipher` ciphertext bytes -- a
global per-user value is not tenant-scoped, so :class:`OrgCipher` does
not apply, and deployment-DEK rotation already has a re-encrypting
consumer slot for new columns like this one.

WebAuthn credentials, when added later, land in a sibling
``login_user_webauthn_credentials`` table keyed on ``user_id``; a
user's overall MFA-enabled state is ``EXISTS(login_user_mfa WHERE
enabled) OR EXISTS(login_user_webauthn_credentials)`` -- the User row
intentionally stays narrow.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Integer, Text
from sqlmodel import Field, SQLModel


class UserMfa(SQLModel, table=True):
    """TOTP MFA state for a single user."""

    __tablename__ = "login_user_mfa"

    user_id: UUID = Field(
        foreign_key="login_users.id",
        primary_key=True,
        nullable=False,
    )
    totp_secret_encrypted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description=(
            "DeploymentCipher ciphertext 'v{n}:...' wrapping the base32 "
            "form of the raw 20-byte TOTP secret. Nullable because a row "
            "may exist for grace-window tracking before BeginEnrollment "
            "generates a secret; populated atomically at enrollment time."
        ),
    )
    enabled: bool = Field(
        default=False,
        nullable=False,
        description="False between BeginEnrollment and ConfirmEnrollment.",
    )
    enrolled_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
        description="Set on ConfirmEnrollment success.",
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
        description="Bumped on each successful VerifyMfa.",
    )
    last_failed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    consecutive_failures: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
        description="Cleared on each successful verify.",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )
