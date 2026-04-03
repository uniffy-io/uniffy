"""Chat message model."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SenderType(str, Enum):
    """Type of message sender."""

    USER = "USER"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"
    GUEST = "GUEST"


class ChatMessage(SQLModel, table=True):
    """A message within a channel.

    Messages are children of channels. root_id = NULL means a root-level message in the
    channel. root_id = <some_message_id> means this is a reply in a thread.

    """

    __tablename__ = "chat_messages"
    __table_args__ = (
        # Main channel timeline query with cursor-based pagination
        Index("ix_chat_messages_channel_timeline", "channel_id", "created_at", "id"),
        # CRT: load only root messages for channel view
        Index(
            "ix_chat_messages_channel_roots",
            "channel_id",
            "created_at",
            "id",
            postgresql_where="root_id IS NULL AND is_deleted = false",
        ),
        # Thread reply loading
        Index(
            "ix_chat_messages_thread_replies",
            "root_id",
            "created_at",
            "id",
            postgresql_where="root_id IS NOT NULL",
        ),
        # Pinned messages list (sparse)
        Index(
            "ix_chat_messages_pinned",
            "channel_id",
            postgresql_where="is_pinned = true AND is_deleted = false",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False),
    )
    sender_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    sender_type: SenderType = Field(
        default=SenderType.USER,
        sa_column=Column(
            SAEnum(SenderType, name="sendertype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
        ),
    )
    content: str = Field(default="", nullable=False)
    root_id: UUID | None = Field(default=None, index=True)
    edited_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    is_deleted: bool = Field(default=False, nullable=False)
    is_pinned: bool = Field(default=False, nullable=False)
    message_metadata: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", PG_JSONB)
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
