"""Organization membership model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class OrganizationRole(str, Enum):
    """Organization-level roles."""

    OWNER = "OWNER"  # Full control, can delete org, manage billing
    ADMIN = "ADMIN"  # Can manage members, settings, but not billing/delete
    MEMBER = "MEMBER"  # Regular member with default access


class OrganizationMemberSource(str, Enum):
    """How a membership row was most recently granted."""

    CREATED = "CREATED"
    INVITE = "INVITE"
    ADDED = "ADDED"
    JIT = "JIT"
    SCIM = "SCIM"
    BOOTSTRAP = "BOOTSTRAP"


class OrganizationMember(SQLModel, table=True):
    """User membership in an organization with an `OrganizationRole`."""

    __tablename__ = "login_organization_members"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "organization_id", name="uq_login_organization_members_user_org"
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    role: OrganizationRole = Field(default=OrganizationRole.MEMBER, nullable=False)
    is_active: bool = Field(default=True, nullable=False)
    source: OrganizationMemberSource = Field(default=OrganizationMemberSource.ADDED, nullable=False)
    invited_by_user_id: UUID | None = Field(
        default=None, foreign_key="login_users.id", ondelete="SET NULL", nullable=True
    )
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    removed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    removed_by_user_id: UUID | None = Field(
        default=None, foreign_key="login_users.id", ondelete="SET NULL", nullable=True
    )

    def __repr__(self) -> str:
        return (
            f"<OrganizationMember(user_id={self.user_id}, "
            f"organization_id={self.organization_id}, role={self.role})>"
        )
