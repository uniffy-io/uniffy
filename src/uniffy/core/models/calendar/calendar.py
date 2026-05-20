"""Calendar model for user calendars."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, CalendarType, ContentRole, generate_id


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
    access_mode : AccessMode
        How access to this calendar is governed.
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    created_at : datetime
        Timestamp when the calendar was created.
    updated_at : datetime
        Timestamp when the calendar was last updated.

    """

    __tablename__ = "calendar_calendars"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
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
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
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

    def __repr__(self) -> str:
        """Return string representation of Calendar."""
        return (
            f"<Calendar(id={self.id}, name={self.name!r}, "
            f"type={self.calendar_type}, owner_id={self.owner_id})>"
        )
