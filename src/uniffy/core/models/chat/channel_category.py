"""Chat channel category model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChatChannelCategory(SQLModel, table=True):
    """Admin-configurable sidebar section for organizing channels.

    Categories provide visual hierarchy in the chat sidebar. Channels with
    category_id = NULL appear in an "Uncategorized" section.

    """

    __tablename__ = "chat_channel_categories"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_chat_categories_org_name"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    position: int = Field(default=0, nullable=False)
    created_by: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
