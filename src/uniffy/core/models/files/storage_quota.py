"""Storage quota model for organization-level storage configuration."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class StorageQuota(SQLModel, table=True):
    """Per-org storage quota configuration; NULL `*_bytes` means unlimited."""

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
        return (
            f"<StorageQuota(id={self.id}, organization_id={self.organization_id}, "
            f"org_quota_bytes={self.org_quota_bytes})>"
        )
