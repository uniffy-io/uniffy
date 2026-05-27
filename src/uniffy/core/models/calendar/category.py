"""Category model for event categorization."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Category(SQLModel, table=True):
    """A category used to color-code and filter calendar events."""

    __tablename__ = "calendar_categories"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    color: str = Field(max_length=50, nullable=False)
    icon: str | None = Field(default=None, max_length=50)
    is_default: bool = Field(default=False, nullable=False)
    sort_order: int = Field(default=0, nullable=False)
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
            f"<Category(id={self.id}, name={self.name!r}, "
            f"color={self.color}, organization_id={self.organization_id})>"
        )
