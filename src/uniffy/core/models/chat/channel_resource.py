"""Chat channel resource model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentType
from uniffy.core.types import generate_id


class ChatChannelResource(SQLModel, table=True):
    """Aggregated record of URN mentions in a channel; rows with mention_count=0 are removed."""

    __tablename__ = "chat_channel_resources"
    __table_args__ = (
        UniqueConstraint("channel_id", "urn", name="uq_chat_resources_channel_urn"),
        Index(
            "ix_chat_resources_channel_type",
            "channel_id",
            "content_type",
            text("last_mentioned_at DESC"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False),
    )
    urn: str = Field(max_length=500, nullable=False)
    content_type: ContentType = Field(
        sa_column=Column(
            SAEnum(
                ContentType,
                name="contenttype",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
        ),
    )
    first_mentioned_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_mentioned_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    mention_count: int = Field(default=1, nullable=False)
    first_mentioned_by: UUID = Field(foreign_key="login_users.id", nullable=False)
