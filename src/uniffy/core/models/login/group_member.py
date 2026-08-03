"""Group membership model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class GroupRole(str, Enum):
    """Group-level roles."""

    ADMIN = "ADMIN"  # Can manage group settings, members
    MEMBER = "MEMBER"  # Regular group member


class GroupMember(SQLModel, table=True):
    """User membership in a group with a `GroupRole`."""

    __tablename__ = "login_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_login_group_members_group_user"),
    )

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
        return f"<GroupMember(user_id={self.user_id}, group_id={self.group_id}, role={self.role})>"
