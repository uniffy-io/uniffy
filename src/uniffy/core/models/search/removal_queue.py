"""Search-index removals that failed inline and await a worker retry."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SearchRemovalQueue(SQLModel, table=True):
    """One pending search removal carrying a URN or typed filter data."""

    __tablename__ = "search_removal_queue"
    __table_args__ = (
        CheckConstraint(
            "urn IS NOT NULL OR filter_spec IS NOT NULL",
            name="ck_search_removal_target",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    urn: str | None = Field(default=None, max_length=255)
    filter_spec: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    organization_id: UUID | None = Field(default=None, nullable=True)
    attempts: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
