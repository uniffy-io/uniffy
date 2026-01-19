"""Settings profile model for user preferences."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class SettingsProfile(SQLModel, table=True):
    """
    Settings profile model representing user-specific configuration.

    Each user can have multiple profiles (e.g., "Default", "Work", "Home")
    with sparse JSONB storage - only user-overridden values are stored,
    code defaults fill in the rest at runtime.

    Attributes
    ----------
    id : UUID
        Unique identifier for the profile (primary key).
    user_id : UUID
        User who owns this profile (foreign key to login_users).
    name : str
        Profile name (e.g., "Default", "Work", "Home").
    appearance : dict | None
        Appearance overrides (theme, accent_color, font_family, etc.).
    keyboard_shortcuts : dict | None
        Keyboard shortcut overrides (only user-changed bindings).
    notifications : dict | None
        Notification preference overrides.
    is_default : bool
        Whether this is the user's default profile.
    created_at : datetime
        Timestamp when the profile was created.
    updated_at : datetime
        Timestamp when the profile was last updated.

    """

    __tablename__ = "settings_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_settings_profiles_user_name"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    appearance: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    keyboard_shortcuts: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    notifications: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
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
        """Return string representation of SettingsProfile."""
        return (
            f"<SettingsProfile(id={self.id}, name={self.name!r}, "
            f"user_id={self.user_id}, is_default={self.is_default})>"
        )
