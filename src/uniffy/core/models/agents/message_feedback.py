"""Thumbs up/down feedback on an agent message; composite PK enforces one per (message, user)."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlmodel import Field, SQLModel


class AgentMessageFeedback(SQLModel, table=True):
    """One user's rating of one assistant message, upserted on re-vote."""

    __tablename__ = "agents_message_feedback"

    message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("agents_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("login_users.id"), primary_key=True),
    )
    rating: str = Field(sa_column=Column(String(8), nullable=False))
    comment: str | None = Field(default=None, sa_column=Column(Text(), nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
