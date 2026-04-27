"""Chat channel member model."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import SubjectType


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

    Composite primary key (channel_id, subject_type, subject_id). Members may
    be users or agents; subject_type discriminates. The legacy user_id column
    stays populated for SUBJECT_TYPE_USER rows during the migration window
    (one release after Phase 4) so existing readers continue to work; new
    code should read subject_type / subject_id directly.

    Cold structural data: changes only on join, leave, role change, or
    notification preference edit. Hot writes happen on chat_messages and
    chat_channel_stats.
    """

    __tablename__ = "chat_channel_members"
    __table_args__ = (
        Index(
            "ix_chat_members_subject_covering",
            "subject_type",
            "subject_id",
            postgresql_include=("channel_id", "role"),
        ),
    )

    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True),
    )
    subject_type: SubjectType = Field(
        sa_column=Column(
            SAEnum(SubjectType, name="subjecttype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
            primary_key=True,
        ),
    )
    subject_id: UUID = Field(primary_key=True, nullable=False)
    user_id: UUID | None = Field(default=None, nullable=True)
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
    muted_until: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    desktop_enabled: bool | None = Field(default=None)
    mobile_enabled: bool | None = Field(default=None)
    badge_all_messages: bool = Field(default=False, nullable=False)
    follow_all_threads: bool = Field(default=False, nullable=False)
