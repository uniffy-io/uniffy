"""Everyone a provider lists on an event, including people outside the organization."""

from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, ForeignKey, Index
from sqlmodel import Field, SQLModel

from uniffy.core.models.calendar.columns import text_enum
from uniffy.core.types import generate_id


class ParticipantResponse(StrEnum):
    ACCEPTED = "ACCEPTED"
    TENTATIVE = "TENTATIVE"
    DECLINED = "DECLINED"
    PENDING = "PENDING"


class CalendarEventParticipant(SQLModel, table=True):
    """A provider-listed guest; members among them also hold an attendee row."""

    __tablename__ = "calendar_event_participants"
    __table_args__ = (
        Index("uq_calendar_event_participants_email", "event_id", "email", unique=True),
        Index("ix_calendar_event_participants_user_id", "user_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    event_id: UUID = Field(
        sa_column=Column(ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False)
    )
    email: str = Field(max_length=320, nullable=False)
    display_name: str | None = Field(default=None, max_length=255)
    response: ParticipantResponse = Field(
        default=ParticipantResponse.PENDING,
        sa_column=Column(text_enum(ParticipantResponse, 20), nullable=False),
    )
    is_organizer: bool = Field(default=False, nullable=False)
    is_optional: bool = Field(default=False, nullable=False)
    user_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("login_users.id", ondelete="SET NULL"), nullable=True),
    )
