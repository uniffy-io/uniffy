"""Saved tag-filter model used by the unified explorer dashboard."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SavedTagFilter(SQLModel, table=True):
    """Persisted filter view for the ``/tags`` explorer.

    Mirrors ``files.saved_filter.SavedFileFilter``: per-user, per-org,
    a ``criteria`` JSONB blob carrying the explorer's filter rail
    state, plus an icon and sort defaults. ``is_preset=True`` rows are
    seeded by the system and may not be edited or deleted by users.

    Criteria JSONB shape (mirrors ``tags.v1.TagFilterCriteria``):

    {
        "tag_ids": [...],
        "content_types": ["note", "file", "calendar_event"],
        "owner_ids": [...],
        "sources": ["manual"],
        "created_after": "2026-01-01T00:00:00Z",
        "created_before": null,
        "updated_after": null,
        "updated_before": null,
        "access_mode": "OPEN_TO_ORG",
        "untagged_only": false
    }
    """

    __tablename__ = "tags_saved_filters"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "name",
            name="uq_tags_saved_filters_name",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
    name: str = Field(max_length=120, nullable=False)
    description: str = Field(default="", max_length=500, nullable=False)
    icon: dict[str, str] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    criteria: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="'{}'::jsonb"),
    )
    sort_by: str = Field(default="count", max_length=32, nullable=False)
    sort_order: str = Field(default="desc", max_length=8, nullable=False)
    is_preset: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<SavedTagFilter(id={self.id}, name={self.name!r}, "
            f"is_preset={self.is_preset}, user_id={self.user_id})>"
        )
