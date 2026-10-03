"""Calendar model for user calendars."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, Index, Text, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, CalendarType, ContentRole, generate_id


class Calendar(SQLModel, table=True):
    """A user calendar that groups events (Personal, Work, Team, Shared)."""

    __tablename__ = "calendar_calendars"
    __table_args__ = (
        Index(
            "uq_calendar_calendars_default",
            "organization_id",
            "owner_id",
            unique=True,
            postgresql_where=text("is_default AND NOT is_deleted"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    name: str = Field(max_length=200, nullable=False)
    description: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
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
    is_deleted: bool = Field(default=False, nullable=False)
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<Calendar(id={self.id}, name={self.name!r}, "
            f"type={self.calendar_type}, owner_id={self.owner_id})>"
        )
