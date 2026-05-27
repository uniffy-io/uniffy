"""User storage quota override model for per-user quota customization."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class UserStorageQuotaOverride(SQLModel, table=True):
    """Per-user storage quota that overrides the org default."""

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
        return (
            f"<UserStorageQuotaOverride(id={self.id}, user_id={self.user_id}, "
            f"quota_bytes={self.quota_bytes})>"
        )
