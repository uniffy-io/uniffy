"""Chat thread models."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import SubjectType


class ChatThread(SQLModel, table=True):
    """Structural metadata for threads. Created on first reply to a root message."""

    __tablename__ = "chat_threads"

    root_message_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_messages.id", ondelete="CASCADE"), primary_key=True),
    )
    channel_id: UUID = Field(
        sa_column=Column(ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ChatThreadStats(SQLModel, table=True):
    """High-frequency counters for thread metadata, separated from ChatThread."""

    __tablename__ = "chat_thread_stats"

    root_message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_threads.root_message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    reply_count: int = Field(default=0, nullable=False)
    last_reply_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class ChatThreadParticipant(SQLModel, table=True):
    """Append-only record of subjects (users or agents) that have participated in a thread."""

    __tablename__ = "chat_thread_participants"

    root_message_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_threads.root_message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    subject_type: SubjectType = Field(
        sa_column=Column(
            SAEnum(SubjectType, name="subjecttype", values_callable=lambda x: [e.value for e in x]),
            nullable=False,
            primary_key=True,
        ),
    )
    subject_id: UUID = Field(primary_key=True, nullable=False)
    user_id: UUID | None = Field(default=None, nullable=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
