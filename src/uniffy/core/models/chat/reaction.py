"""Chat reaction model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlmodel import Field, SQLModel


class ChatReaction(SQLModel, table=True):
    """An emoji reaction on a message; composite PK enforces one per (message, user, emoji)."""

    __tablename__ = "chat_reactions"
    __table_args__ = (Index("ix_chat_reactions_message", "message_id", "emoji"),)

    message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id"), primary_key=True),
    )
    emoji: str = Field(
        sa_column=Column(String(64), primary_key=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
