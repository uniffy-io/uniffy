"""Group model for organization-level teams."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class Group(SQLModel, table=True):
    """Org-scoped team. Used as a permission subject in `ContentMember` grants."""

    __tablename__ = "login_groups"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=255, nullable=False)
    slug: str = Field(max_length=255, nullable=False, index=True)
    description: str | None = Field(default=None, max_length=1000)
    is_private: bool = Field(default=False, nullable=False)
    is_default: bool = Field(default=False, nullable=False)
    created_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return f"<Group(id={self.id}, name={self.name}, organization_id={self.organization_id})>"
