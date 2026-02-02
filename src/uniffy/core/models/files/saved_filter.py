"""Saved file filter model for custom file filtering presets."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class SavedFileFilter(SQLModel, table=True):
    """
    Saved file filter model for custom file filtering presets.

    Users can save filter configurations (extension, size, date, etc.)
    and reapply them quickly. System presets are marked with is_preset=True.

    Criteria JSONB structure:
    {
        "extensions": ["pdf", "docx"],       # File extensions (without dot)
        "mime_categories": ["document"],     # document, image, video, audio, archive
        "owner_ids": ["uuid1", "uuid2"],     # Filter by owner
        "visibility": "PRIVATE",             # VisibilityScope value
        "tags": ["important", "work"],       # Filter by tags
        "size_min_bytes": 1024,              # Minimum file size
        "size_max_bytes": 10485760,          # Maximum file size
        "created_after": "2024-01-01T00:00:00Z",   # Created after date
        "created_before": "2024-12-31T23:59:59Z",  # Created before date
    }

    Icon JSONB structure:
    {
        "type": "icon",     # "icon" for Phosphor icons, "emoji" for emojis
        "value": "Funnel",  # Icon name or emoji character
    }

    Attributes
    ----------
    id : UUID
        Unique identifier for the saved filter (primary key).
    user_id : UUID
        User who created the filter (foreign key to login_users).
    organization_id : UUID
        Organization this filter belongs to (foreign key).
    name : str
        Display name for the filter.
    description : str | None
        Optional description of what this filter does.
    icon : dict[str, str] | None
        Optional icon for the filter (type + value).
    criteria : dict[str, Any]
        JSONB containing filter criteria.
    is_preset : bool
        If True, this is a system preset and cannot be edited/deleted.
    sort_by : str | None
        Default sort field when applying this filter.
    sort_order : str | None
        Default sort order (asc/desc) when applying this filter.
    created_at : datetime
        Timestamp when the filter was created.
    updated_at : datetime
        Timestamp when the filter was last updated.

    """

    __tablename__ = "files_saved_filters"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "name",
            name="uq_saved_filters_user_org_name",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
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
        """Return string representation of SavedFileFilter."""
        return (
            f"<SavedFileFilter(id={self.id}, name={self.name!r}, "
            f"is_preset={self.is_preset}, user_id={self.user_id})>"
        )
