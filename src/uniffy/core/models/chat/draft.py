"""Chat draft model."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, text
from sqlmodel import Field, SQLModel


class ChatDraft(SQLModel, table=True):
    """Per-user unsent composer text; canonical Markdown, synced across devices."""

    __tablename__ = "chat_drafts"
    __table_args__ = (
        Index("ix_chat_drafts_user_org", "user_id", "organization_id"),
        Index(
            "uq_chat_drafts_channel",
            "user_id",
            "channel_id",
            unique=True,
            postgresql_where=text("root_message_id IS NULL"),
        ),
        Index(
            "uq_chat_drafts_thread",
            "user_id",
            "channel_id",
            "root_message_id",
            unique=True,
            postgresql_where=text("root_message_id IS NOT NULL"),
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), nullable=False),
    )
    organization_id: UUID = Field(
        sa_column=Column(ForeignKey("login_organizations.id", ondelete="CASCADE"), nullable=False),
    )
    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False),
    )
    # FK targets the root message itself, not chat_threads: thread rows are
    # created lazily on the first reply, and a draft of that first reply
    # legitimately precedes the thread row.
    root_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    content: str = Field(nullable=False)
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
