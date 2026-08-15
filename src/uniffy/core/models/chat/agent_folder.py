"""Per-user folder for organizing agent DM chats in the sidebar."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChatAgentFolder(SQLModel, table=True):
    """Private to one user, unlike ChatChannelCategory which is org-wide."""

    __tablename__ = "chat_agent_folders"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", "name", name="uq_agent_folders_user_name"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    name: str = Field(max_length=100, nullable=False)
    position: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
