"""Chat channel and channel stats models."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChannelType(str, Enum):
    """Type of chat channel."""

    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"
    DIRECT = "DIRECT"
    GROUP_DM = "GROUP_DM"


class ChatChannel(SQLModel, table=True):
    """Chat channel - a persistent conversation container.

    This is the primary chat content entity (bookmarkable, searchable, mentionable via URN).
    Structural metadata only - counters and timestamps live in ChatChannelStats.

    """

    __tablename__ = "chat_channels"
    __table_args__ = (UniqueConstraint("organization_id", "slug", name="uq_chat_channels_org_slug"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=200, nullable=False)
    slug: str = Field(max_length=200, nullable=False)
    description: str = Field(default="", nullable=False)
    channel_type: ChannelType = Field(
        sa_column=Column(
            SAEnum(ChannelType, name="channeltype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
            index=True,
        ),
    )
    is_encrypted: bool = Field(default=False, nullable=False)
    is_archived: bool = Field(default=False, nullable=False)
    is_default: bool = Field(default=False, nullable=False)
    is_deleted: bool = Field(default=False, nullable=False)
    icon: str = Field(default="", nullable=False)
    category_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("chat_channel_categories.id", ondelete="SET NULL"), index=True),
    )
    is_agent_dm: bool = Field(default=False, nullable=False)
    custom_name: str | None = Field(default=None, max_length=200, nullable=True)
    agent_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("agents_agents.id", ondelete="SET NULL"), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    @property
    def effective_name(self) -> str:
        """Display name preferring user override over the auto-generated name."""
        if self.custom_name and self.custom_name.strip():
            return self.custom_name
        return self.name


class ChatChannelStats(SQLModel, table=True):
    """Separated counter table for chat channels.

    Every message send locks this row instead of the channel row, keeping structural
    metadata contention-free. One row per channel, created when the channel is created.

    """

    __tablename__ = "chat_channel_stats"

    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True),
    )
    message_count: int = Field(default=0, nullable=False)
    root_message_count: int = Field(default=0, nullable=False)
    last_message_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    last_root_message_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    member_count: int = Field(default=0, nullable=False)
