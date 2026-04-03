"""Chat thread follow model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlmodel import Field, SQLModel


class ChatThreadFollow(SQLModel, table=True):
    """Tracks which threads a user is following.

    Insert to follow, delete to unfollow. Auto-followed when user starts
    a thread, replies in a thread, or is @mentioned in a thread.

    """

    __tablename__ = "chat_thread_follows"
    __table_args__ = (
        Index("ix_chat_thread_follows_user", "user_id"),
    )

    root_message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_threads.root_message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id", ondelete="CASCADE"), primary_key=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
