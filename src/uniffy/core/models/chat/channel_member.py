"""Chat channel member model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class ChannelRole(str, Enum):
    """Role of a member within a chat channel."""

    OWNER = "OWNER"
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class ChatNotificationLevel(str, Enum):
    """Per-channel notification preference."""

    ALL = "ALL"
    MENTIONS = "MENTIONS"
    NONE = "NONE"


class ChatChannelMember(SQLModel, table=True):
    """Tracks channel membership and notification preferences.

    Composite primary key (channel_id, user_id). This table stores cold structural
    data - it changes when a user adjusts notification preferences or gets promoted,
    not during normal messaging.

    """

    __tablename__ = "chat_channel_members"
    __table_args__ = (
        Index("ix_chat_members_user", "user_id"),
    )

    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True),
    )
    role: ChannelRole = Field(
        default=ChannelRole.MEMBER,
        sa_column=Column(
            SAEnum(ChannelRole, name="channelrole", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
        ),
    )
    notification_level: ChatNotificationLevel = Field(
        default=ChatNotificationLevel.ALL,
        sa_column=Column(
            SAEnum(
                ChatNotificationLevel,
                name="chatnotificationlevel",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    is_muted: bool = Field(default=False, nullable=False)
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # Extended notification preference fields (nullable = inherit global)
    desktop_enabled: bool | None = Field(default=None)
    mobile_enabled: bool | None = Field(default=None)
    badge_all_messages: bool = Field(default=False, nullable=False)
    follow_all_threads: bool = Field(default=False, nullable=False)
