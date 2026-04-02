"""RoomBooking model for room reservation records."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import BookingStatus
from uniffy.core.types import generate_id


class RoomBooking(SQLModel, table=True):
    """
    RoomBooking model representing a reservation of a room for a time slot.

    Bookings can be standalone or linked to a calendar event via event_id.
    Conflict detection uses the compound index on (room_id, start_time, end_time).

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    room_id : UUID
        The booked room (FK to rooms_rooms).
    organization_id : UUID
        Organization scope.
    user_id : UUID
        The user who made the booking.
    event_id : UUID | None
        Optional linked calendar event.
    title : str
        Booking title (for standalone bookings or override label).
    start_time : datetime
        Booking start time (with timezone).
    end_time : datetime
        Booking end time (with timezone).
    status : BookingStatus
        Booking status (CONFIRMED, CANCELLED).
    notes : str
        Additional notes for the booking.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "rooms_bookings"
    __table_args__ = (
        Index("ix_rooms_bookings_conflict", "room_id", "start_time", "end_time"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    room_id: UUID = Field(foreign_key="rooms_rooms.id", nullable=False, index=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    event_id: UUID | None = Field(default=None, foreign_key="calendar_events.id", index=True)
    title: str = Field(default="", max_length=500, nullable=False)
    start_time: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    end_time: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    status: BookingStatus = Field(
        default=BookingStatus.CONFIRMED,
        sa_column=Column(
            Enum(
                BookingStatus,
                name="bookingstatus",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
        ),
    )
    notes: str = Field(default="", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of RoomBooking."""
        return (
            f"<RoomBooking(id={self.id}, room_id={self.room_id}, "
            f"start={self.start_time}, end={self.end_time}, status={self.status})>"
        )
