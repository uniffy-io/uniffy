"""EventTemplate model for calendar event templates."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import VisibilityScope


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
    visibility : VisibilityScope
        Template visibility.
    created_by : UUID
        User who created the template.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.
    """

    __tablename__ = "calendar_event_templates"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    organization_id: UUID = Field(index=True, nullable=False)

    title: str = Field(nullable=False)
    description: str = Field(default="")
    duration_minutes: int = Field(default=30)

    location: str = Field(default="")
    meeting_url: str | None = Field(default=None, nullable=True)

    category_id: UUID | None = Field(default=None, nullable=True)

    tags: list[str] = Field(default=[], sa_column=Column(JSONB))

    visibility: VisibilityScope = Field(
        default=VisibilityScope.PRIVATE,
        sa_column=Column(
            Enum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
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
