"""Thumbs up/down feedback on an agent reply, in a session or in chat."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentMessageFeedback(SQLModel, table=True):
    """One user's rating of one agent reply; the reply lives either in an
    agent session (agents_message_id) or in chat (chat_message_id), never both.
    """

    __tablename__ = "agents_message_feedback"
    __table_args__ = (
        CheckConstraint(
            "(agents_message_id IS NULL) != (chat_message_id IS NULL)",
            name="ck_agents_message_feedback_one_target",
        ),
        Index(
            "uq_agents_message_feedback_session",
            "agents_message_id",
            "user_id",
            unique=True,
            postgresql_where=text("agents_message_id IS NOT NULL"),
        ),
        Index(
            "uq_agents_message_feedback_chat",
            "chat_message_id",
            "user_id",
            unique=True,
            postgresql_where=text("chat_message_id IS NOT NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    agents_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("agents_messages.id", ondelete="CASCADE"), nullable=True),
    )
    chat_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True),
    )
    user_id: UUID = Field(sa_column=Column(ForeignKey("login_users.id"), nullable=False))
    rating: str = Field(sa_column=Column(String(8), nullable=False))
    comment: str | None = Field(default=None, sa_column=Column(Text(), nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
