"""Chat read cursor models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlmodel import Field, SQLModel


class ChatReadCursor(SQLModel, table=True):
    """Per-user, per-channel read position; Valkey-first, periodically flushed to PG."""

    __tablename__ = "chat_read_cursors"
    __table_args__ = (Index("ix_chat_read_cursors_user", "user_id"),)

    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), primary_key=True),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True),
    )
    last_read_message_id: UUID | None = Field(default=None)
    last_read_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class ChatThreadReadCursor(SQLModel, table=True):
    """Per-user, per-thread read position; Valkey-first like ChatReadCursor."""

    __tablename__ = "chat_thread_read_cursors"

    root_message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_threads.root_message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True),
    )
    last_read_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    unread_mentions: int = Field(default=0, nullable=False)
