"""Chat message model."""

from datetime import UTC, datetime
from enum import Enum, StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class SenderType(str, Enum):
    USER = "USER"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"
    GUEST = "GUEST"


class ChatMessageMetadataKind(StrEnum):
    FINAL = "final"
    SUMMARY = "summary"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    CONTEXT_RESET = "context_reset"
    AGENT_ERROR = "agent_error"
    SKILL_DRAFT = "skill_draft"
    IMAGE_GENERATION = "image_generation"
    # SYSTEM breadcrumb kinds: clients classify the capsule by this, never by
    # matching the message wording.
    CALL_STARTED = "call_started"
    CALL_ENDED = "call_ended"
    MEMBER_JOINED = "member_joined"


class ChatMessageVisibility(StrEnum):
    AGENT_INTERNAL = "agent_internal"


class ChatMessageMetadataKey(StrEnum):
    FORWARD = "forward"
    THREAD_REPLY = "thread_reply"


class ChatMessage(SQLModel, table=True):
    """A chat message in a channel; root_id IS NULL marks a root message,
    otherwise it is a thread reply.
    """

    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_channel_timeline", "channel_id", "created_at", "id"),
        Index(
            "ix_chat_messages_channel_roots",
            "channel_id",
            "created_at",
            "id",
            postgresql_where="root_id IS NULL AND is_deleted = false",
        ),
        Index(
            "ix_chat_messages_thread_replies",
            "root_id",
            "created_at",
            "id",
            postgresql_where="root_id IS NOT NULL",
        ),
        Index(
            "ix_chat_messages_pinned",
            "channel_id",
            postgresql_where="is_pinned = true AND is_deleted = false",
        ),
        Index(
            "ix_chat_messages_channel_agent",
            "channel_id",
            "sender_id",
            "created_at",
            postgresql_where="sender_type = 'AGENT' AND is_deleted = false",
        ),
        Index(
            "ix_chat_messages_mentioned_agents",
            "mentioned_agent_ids",
            postgresql_using="gin",
            postgresql_where="mentioned_agent_ids IS NOT NULL",
        ),
        Index(
            "ix_chat_messages_mentioned_urns",
            "mentioned_urns",
            postgresql_using="gin",
            postgresql_where="mentioned_urns IS NOT NULL",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False),
    )
    sender_id: UUID = Field(nullable=False, index=True)
    sender_type: SenderType = Field(
        default=SenderType.USER,
        sa_column=Column(
            SAEnum(SenderType, name="sendertype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
        ),
    )
    content: str = Field(default="", nullable=False)
    root_id: UUID | None = Field(default=None, index=True)
    reply_to_id: UUID | None = Field(default=None, index=True)
    edited_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    is_deleted: bool = Field(default=False, nullable=False)
    is_pinned: bool = Field(default=False, nullable=False)
    message_metadata: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", PG_JSONB)
    )
    mentioned_agent_ids: list[UUID] | None = Field(
        default=None, sa_column=Column(PG_ARRAY(PG_UUID(as_uuid=True)), nullable=True)
    )
    mentioned_urns: list[str] | None = Field(
        default=None, sa_column=Column(PG_ARRAY(Text()), nullable=True)
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
