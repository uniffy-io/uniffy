"""Organization model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Organization(SQLModel, table=True):
    """Tenant boundary; every content row scopes to one organization."""

    __tablename__ = "login_organizations"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    name: str = Field(max_length=255, nullable=False)
    slug: str = Field(max_length=255, unique=True, index=True, nullable=False)
    domain: str | None = Field(default=None, max_length=255, index=True)
    is_active: bool = Field(default=True, nullable=False)
    plan: str = Field(default="free", max_length=50, nullable=False)
    max_members: int | None = Field(default=None)
    is_suspended: bool = Field(default=False, nullable=False, index=True)
    suspended_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    suspended_by_user_id: UUID | None = Field(default=None, nullable=True)
    suspension_reason: str | None = Field(default=None, max_length=1000)
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True, index=True),
    )
    deleted_by_user_id: UUID | None = Field(default=None, nullable=True)
    deletion_reason: str | None = Field(default=None, max_length=1000)
    purge_warning_sent_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return f"<Organization(id={self.id}, name={self.name}, slug={self.slug})>"
