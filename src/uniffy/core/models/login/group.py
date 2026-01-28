"""Group model for organization-level teams."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class Group(SQLModel, table=True):
    """
    Group model representing teams within an organization.

    Groups are organization-scoped teams/channels (like Slack channels).
    Each group belongs to one organization.

    Attributes
    ----------
    id : UUID
        Unique identifier for the group (primary key).
    organization_id : UUID
        Foreign key to organizations table.
    name : str
        Group name within the organization.
    slug : str
        URL-friendly slug (unique within organization).
    description : str | None
        Optional group description.
    is_private : bool
        Whether the group is private (invite-only) or public.
    is_default : bool
        Whether new org members auto-join this group.
    created_by_user_id : UUID
        User who created the group.
    created_at : datetime
        Timestamp when the group was created.
    updated_at : datetime
        Timestamp when the group was last updated.

    """

    __tablename__ = "login_groups"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
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
        """Return string representation of Group."""
        return f"<Group(id={self.id}, name={self.name}, organization_id={self.organization_id})>"
