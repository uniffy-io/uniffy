"""Calendar model for user calendars."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field, SQLModel

from uwos.core.models.shared import CalendarType


class Calendar(SQLModel, table=True):
    """
    Calendar model representing a user's calendar.

    Users can have multiple calendars (Personal, Work, Team, etc.)
    that organize their events.

    Attributes
    ----------
    id : UUID
        Unique identifier for the calendar (primary key).
    organization_id : UUID
        Organization this calendar belongs to (foreign key).
    owner_id : UUID
        User who owns the calendar (foreign key to login_users).
    name : str
        Calendar display name.
    color : str
        Color for calendar events (hex format).
    is_visible : bool
        Whether calendar is visible in the grid.
    is_default : bool
        Whether this is the default calendar for new events.
    calendar_type : CalendarType
        Type of calendar (PERSONAL, WORK, TEAM, SHARED).
    created_at : datetime
        Timestamp when the calendar was created.
    updated_at : datetime
        Timestamp when the calendar was last updated.

    """

    __tablename__ = "calendar_calendars"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=200, nullable=False)
    color: str = Field(max_length=50, default="#3B82F6", nullable=False)
    is_visible: bool = Field(default=True, nullable=False)
    is_default: bool = Field(default=False, nullable=False)
    calendar_type: CalendarType = Field(
        default=CalendarType.PERSONAL,
        sa_column=Column(
            Enum(
                CalendarType,
                name="calendartype",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
            index=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    @property
    def urn(self) -> str:
        """Return the URN for this calendar."""
        return f"urn:uwos:content:CALENDAR:{self.id}"

    def __repr__(self) -> str:
        """Return string representation of Calendar."""
        return (
            f"<Calendar(id={self.id}, name={self.name!r}, "
            f"type={self.calendar_type}, owner_id={self.owner_id})>"
        )
