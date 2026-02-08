"""Group membership model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class GroupRole(str, Enum):
    """Group-level roles."""

    ADMIN = "ADMIN"  # Can manage group settings, members
    MEMBER = "MEMBER"  # Regular group member


class GroupMember(SQLModel, table=True):
    """
    Link table between Users and Groups.

    Represents a user's membership in a group with a specific role.

    Attributes
    ----------
    id : UUID
        Unique identifier for the group membership (primary key).
    user_id : UUID
        Foreign key to users table.
    group_id : UUID
        Foreign key to groups table.
    role : GroupRole
        User's role within this group.
    is_active : bool
        Whether the membership is active.
    joined_at : datetime
        Timestamp when the user joined the group.
    updated_at : datetime
        Timestamp when the membership was last updated.

    """

    __tablename__ = "login_group_members"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    group_id: UUID = Field(foreign_key="login_groups.id", nullable=False, index=True)
    role: GroupRole = Field(default=GroupRole.MEMBER, nullable=False)
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
        """Return string representation of GroupMember."""
        return f"<GroupMember(user_id={self.user_id}, group_id={self.group_id}, role={self.role})>"
