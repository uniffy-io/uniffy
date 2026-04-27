"""Storage quota model for organization-level storage configuration."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class StorageQuota(SQLModel, table=True):
    """
    Organization-level storage quota configuration.

    Controls storage limits for an entire organization and sets
    the default per-user quota. Each organization can have at most
    one quota configuration row.

    Attributes
    ----------
    id : UUID
        Primary key.
    organization_id : UUID
        Organization this quota applies to (unique).
    org_quota_bytes : int | None
        Total organization storage limit in bytes. None means unlimited.
    default_user_quota_bytes : int | None
        Default per-user storage limit in bytes. None means unlimited.
    warn_at_percent : int
        Percentage threshold at which to show a warning (default 80).
    enforce : bool
        Whether to block uploads when quota is exceeded (default True).
        When False, only warnings are shown.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "files_storage_quotas"
    __table_args__ = (UniqueConstraint("organization_id", name="uq_storage_quota_org"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    org_quota_bytes: int | None = Field(
        default=None,
        sa_column=Column(BigInteger, nullable=True),
    )
    default_user_quota_bytes: int | None = Field(
        default=None,
        sa_column=Column(BigInteger, nullable=True),
    )
    warn_at_percent: int = Field(
        default=80,
        sa_column=Column(Integer, nullable=False, server_default="80"),
    )
    enforce: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of StorageQuota."""
        return (
            f"<StorageQuota(id={self.id}, organization_id={self.organization_id}, "
            f"org_quota_bytes={self.org_quota_bytes})>"
        )
