"""Organization membership model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class OrganizationRole(str, Enum):
    """Organization-level roles."""

    OWNER = "OWNER"  # Full control, can delete org, manage billing
    ADMIN = "ADMIN"  # Can manage members, settings, but not billing/delete
    MEMBER = "MEMBER"  # Regular member with default access


class OrganizationMember(SQLModel, table=True):
    """User membership in an organization with an `OrganizationRole`."""

    __tablename__ = "login_organization_members"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER, nullable=False)
    is_active: bool = Field(default=True, nullable=False)
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<OrganizationMember(user_id={self.user_id}, "
            f"organization_id={self.organization_id}, role={self.role})>"
        )
