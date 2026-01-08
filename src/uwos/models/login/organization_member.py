"""Organization membership model."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class OrganizationRole(str, Enum):
    """Organization-level roles."""

    OWNER = "owner"  # Full control, can delete org, manage billing
    ADMIN = "admin"  # Can manage members, settings, but not billing/delete
    MEMBER = "member"  # Regular member with default access


class OrganizationMember(SQLModel, table=True):
    """
    Link table between Users and Organizations.

    Represents a user's membership in an organization with a specific role.

    Attributes
    ----------
    id : UUID
        Unique identifier for the membership (primary key).
    user_id : UUID
        Foreign key to users table.
    organization_id : UUID
        Foreign key to organizations table.
    role : OrganizationRole
        User's role within this organization.
    is_active : bool
        Whether the membership is active (for soft suspension).
    joined_at : datetime
        Timestamp when the user joined the organization.
    updated_at : datetime
        Timestamp when the membership was last updated.

    """

    __tablename__ = "login_organization_members"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER, nullable=False)
    is_active: bool = Field(default=True, nullable=False)
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(timezone.utc)),
    )

    def __repr__(self) -> str:
        """Return string representation of OrganizationMember."""
        return (
            f"<OrganizationMember(user_id={self.user_id}, "
            f"organization_id={self.organization_id}, role={self.role})>"
        )
