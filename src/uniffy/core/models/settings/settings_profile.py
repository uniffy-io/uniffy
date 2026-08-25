"""Settings profile model for user preferences."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SettingsProfile(SQLModel, table=True):
    """Per-user settings profile. JSONB columns store only user-overridden
    values; code defaults fill the rest.
    """

    __tablename__ = "settings_profiles"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_settings_profiles_user_name"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    appearance: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    keyboard_shortcuts: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    notifications: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    scheduling: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    custom_status: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    is_default: bool = Field(default=False, nullable=False)
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
            f"<SettingsProfile(id={self.id}, name={self.name!r}, "
            f"user_id={self.user_id}, is_default={self.is_default})>"
        )
