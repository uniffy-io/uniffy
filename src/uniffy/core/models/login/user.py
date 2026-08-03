"""User model."""

import os
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, LargeBinary
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class User(SQLModel, table=True):
    """Global user account; org membership is recorded via `OrganizationMember`.

    `is_system_admin=True` marks platform operators (cloud); it does NOT bypass
    `PermissionChecker` for tenant content - access requires a `SupportSession`.
    `token_version` is bumped on security events to invalidate outstanding JWTs.
    """

    __tablename__ = "login_users"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    email: str = Field(max_length=255, unique=True, index=True, nullable=False)
    username: str = Field(max_length=255, unique=True, index=True, nullable=False)
    full_name: str | None = Field(default=None, max_length=255)
    hashed_password: str | None = Field(default=None, max_length=255)
    is_active: bool = Field(default=True, nullable=False)
    is_system_admin: bool = Field(default=False, nullable=False)
    email_verified: bool = Field(default=False, nullable=False)
    token_version: int = Field(
        default=1,
        nullable=False,
        description="Token version for immediate token revocation. Incremented on security events.",
    )
    pronouns: str | None = Field(
        default=None,
        max_length=50,
        description="Self-set pronouns shown beside the name, org-independent.",
    )
    accent_color: str | None = Field(
        default=None,
        max_length=50,
        description="User's preferred accent color in HSL format (e.g., '221.2 83.2% 53.3%')",
    )
    font_family: str | None = Field(
        default=None,
        max_length=20,
        description="User's preferred font family: 'inter', 'geist', or 'system'",
    )
    avatar_key: str | None = Field(
        default=None,
        max_length=512,
        description="S3 key prefix for avatar images (e.g., 'avatars/{user_id}/{hash}')",
    )
    cache_key_seed: bytes = Field(
        default_factory=lambda: os.urandom(32),
        sa_column=Column(LargeBinary(32), nullable=False),
        description="32-byte random seed for client-side storage encryption key derivation.",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    @property
    def urn(self) -> str:
        return f"urn:uniffy:content:USER:{self.id}"

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username}, email={self.email})>"
