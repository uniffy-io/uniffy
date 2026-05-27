"""Room model for bookable rooms and resources."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, RoomStatus, RoomType, generate_id


class Room(SQLModel, table=True):
    """Bookable room or resource (meeting room, equipment, vehicle)."""

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
        return f"urn:uniffy:content:ROOM:{self.id}"

    def __repr__(self) -> str:
        return (
            f"<Room(id={self.id}, name={self.name!r}, "
            f"room_type={self.room_type}, organization_id={self.organization_id})>"
        )
