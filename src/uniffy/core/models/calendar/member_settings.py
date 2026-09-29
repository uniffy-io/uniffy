"""One member's view of a calendar they can see."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey
from sqlmodel import Field, SQLModel


class CalendarMemberSettings(SQLModel, table=True):
    """Per-member choices about a calendar; the calendar's own row is shared by everyone."""

    __tablename__ = "calendar_member_settings"

    calendar_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    user_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    is_hidden: bool = Field(default=False, nullable=False)
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
