"""User storage quota override model for per-user quota customization."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class UserStorageQuotaOverride(SQLModel, table=True):
    """
    Per-user storage quota override.

    Allows administrators to set a custom storage limit for a specific
    user that takes precedence over the organization default. For example,
    a power user who needs more storage than the default allows.

    Attributes
    ----------
    id : UUID
        Primary key.
    organization_id : UUID
        Organization this override belongs to.
    user_id : UUID
        User this override applies to.
    quota_bytes : int
        Custom storage limit in bytes for this user.
    note : str | None
        Administrative note explaining why the override was set.
    created_by : UUID
        Admin user who created or last updated this override.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "files_user_storage_quota_overrides"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_user_storage_quota_override_org_user",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    quota_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    note: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    created_by: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of UserStorageQuotaOverride."""
        return (
            f"<UserStorageQuotaOverride(id={self.id}, user_id={self.user_id}, "
            f"quota_bytes={self.quota_bytes})>"
        )
