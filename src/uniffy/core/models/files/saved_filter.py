"""Saved file filter model for custom file filtering presets."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SavedFileFilter(SQLModel, table=True):
    """User-saved file filter preset (criteria + icon as JSONB). System presets are read-only."""

    __tablename__ = "files_saved_filters"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "name",
            name="uq_saved_filters_user_org_name",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    description: str | None = Field(default=None, max_length=500)
    icon: dict[str, str] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    criteria: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False))
    is_preset: bool = Field(default=False, nullable=False)
    sort_by: str | None = Field(default=None, max_length=50)
    sort_order: str | None = Field(default=None, max_length=10)
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
            f"<SavedFileFilter(id={self.id}, name={self.name!r}, "
            f"is_preset={self.is_preset}, user_id={self.user_id})>"
        )
