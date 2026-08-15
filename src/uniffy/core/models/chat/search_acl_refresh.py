"""Durable intent to refresh historical chat-message search ACLs."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlmodel import Field, SQLModel


class ChatSearchAclRefresh(SQLModel, table=True):
    __tablename__ = "chat_search_acl_refresh_queue"
    __table_args__ = (Index("ix_chat_search_acl_refresh_created", "created_at"),)

    channel_id: UUID = Field(
        sa_column=Column(
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    version: int = Field(default=1, nullable=False)
    attempts: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
