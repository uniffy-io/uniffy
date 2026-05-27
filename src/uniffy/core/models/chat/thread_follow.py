"""Chat thread follow model."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import SubjectType


class ChatThreadFollow(SQLModel, table=True):
    """A follow relationship between a subject (user or agent) and a thread."""

    __tablename__ = "chat_thread_follows"
    __table_args__ = (Index("ix_chat_thread_follows_subject", "subject_type", "subject_id"),)

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
