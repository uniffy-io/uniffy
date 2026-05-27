"""Storage usage model for materialized usage tracking."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class StorageUsage(SQLModel, table=True):
    """Materialized per-user storage totals to avoid aggregating files on every upload.

    Incrementally updated on upload completion and permanent delete; a periodic
    recalculation job corrects drift.
    """

    __tablename__ = "files_storage_usage"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_storage_usage_org_user",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    used_bytes: int = Field(
        default=0,
        sa_column=Column(BigInteger, nullable=False, server_default="0"),
    )
    file_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
    )
    last_recalculated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<StorageUsage(id={self.id}, user_id={self.user_id}, "
            f"used_bytes={self.used_bytes}, file_count={self.file_count})>"
        )
