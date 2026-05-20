"""EventTemplate model for calendar event templates."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class EventTemplate(SQLModel, table=True):
    """
    EventTemplate model representing a reusable template for calendar events.

    Templates store default values for creating new events quickly.

    Attributes
    ----------
    id : UUID
        Unique identifier for the template.
    organization_id : UUID
        Organization this template belongs to.
    title : str
        Template title/name.
    description : str
        Template description or default event description.
    duration_minutes : int
        Default duration in minutes.
    location : str
        Default location.
    meeting_url : str | None
        Default meeting URL.
    category_id : UUID | None
        Default category.
    tags : list[str]
        Default tags.
    access_mode : AccessMode
        How access to this template is governed.
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    created_by : UUID
        User who created the template.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.
    """

    __tablename__ = "calendar_event_templates"

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID = Field(index=True, nullable=False)

    title: str = Field(nullable=False)
    description: str = Field(default="")
    duration_minutes: int = Field(default=30)

    location: str = Field(default="")
    meeting_url: str | None = Field(default=None, nullable=True)

    category_id: UUID | None = Field(default=None, nullable=True)

    tags: list[str] = Field(default=[], sa_column=Column(JSONB))

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

    created_by: UUID = Field(nullable=False)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), nullable=False, onupdate=lambda: datetime.now(UTC)
        ),
    )
