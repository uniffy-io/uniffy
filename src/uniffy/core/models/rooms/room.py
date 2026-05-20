"""Room model for bookable rooms and resources."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, RoomStatus, RoomType, generate_id


class Room(SQLModel, table=True):
    """
    Room model representing a bookable room or resource.

    Rooms are organization-scoped and support different types (meeting rooms,
    equipment, vehicles, etc.). They use the standard permission model and
    can be booked through the RoomBooking model.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key).
    organization_id : UUID
        Organization this room belongs to.
    owner_id : UUID
        User who created/manages the room.
    name : str
        Room display name.
    description : str
        Room description in markdown format.
    room_type : RoomType
        Type of room or resource.
    status : RoomStatus
        Operational status (ACTIVE, MAINTENANCE, RETIRED).
    capacity : int
        Maximum number of people (0 for non-space resources).
    floor : str | None
        Floor identifier.
    building : str | None
        Building name.
    location : str
        Human-readable location description.
    amenities : list[str] | None
        Available amenities (projector, whiteboard, etc.).
    image_file_id : UUID | None
        Optional photo of the room (FK to files).
    access_mode : AccessMode
        How access to this room is governed.
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    is_deleted : bool
        Soft delete flag.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.
    deleted_at : datetime | None
        Soft deletion timestamp.

    """

    __tablename__ = "rooms_rooms"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=255, nullable=False)
    description: str = Field(default="", nullable=False)
    room_type: RoomType = Field(
        sa_column=Column(
            Enum(
                RoomType,
                name="roomtype",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
        ),
    )
    status: RoomStatus = Field(
        default=RoomStatus.ACTIVE,
        sa_column=Column(
            Enum(
                RoomStatus,
                name="roomstatus",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
        ),
    )
    capacity: int = Field(default=0, nullable=False)
    floor: str | None = Field(default=None, max_length=50)
    building: str | None = Field(default=None, max_length=100)
    location: str = Field(default="", max_length=500, nullable=False)
    amenities: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    image_file_id: UUID | None = Field(default=None)
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
    is_deleted: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    @property
    def urn(self) -> str:
        """Return the URN for this room."""
        return f"urn:uniffy:content:ROOM:{self.id}"

    def __repr__(self) -> str:
        """Return string representation of Room."""
        return (
            f"<Room(id={self.id}, name={self.name!r}, "
            f"room_type={self.room_type}, organization_id={self.organization_id})>"
        )
