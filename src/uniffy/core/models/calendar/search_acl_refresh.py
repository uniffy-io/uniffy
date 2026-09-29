"""Durable intent to refresh event search ACLs inherited from a calendar."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index
from sqlmodel import Field, SQLModel


class CalendarSearchAclRefresh(SQLModel, table=True):
    __tablename__ = "calendar_search_acl_refresh_queue"
    __table_args__ = (Index("ix_calendar_search_acl_refresh_created", "created_at"),)

    calendar_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
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
