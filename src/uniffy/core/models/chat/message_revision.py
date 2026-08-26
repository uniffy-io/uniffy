"""Chat message edit-history model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChatMessageRevision(SQLModel, table=True):
    """The content a chat message held before one edit replaced it."""

    __tablename__ = "chat_message_revisions"
    __table_args__ = (
        Index("ix_chat_message_revisions_message", "message_id", "revision_no", unique=True),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    message_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
    )
    revision_no: int = Field(nullable=False)
    content: str = Field(sa_column=Column(Text(), nullable=False))
    edited_by: UUID = Field(nullable=False)
    edited_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
