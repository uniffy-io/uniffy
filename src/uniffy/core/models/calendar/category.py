"""Category model for event categorization."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class Category(SQLModel, table=True):
    """
    Category model for event color coding and filtering.

    Categories help users organize events by type (Meetings, Deep Work, etc.)
    and provide visual distinction through colors.

    Attributes
    ----------
    id : UUID
        Unique identifier for the category (primary key).
    organization_id : UUID
        Organization this category belongs to (foreign key).
    name : str
        Category display name.
    color : str
        Category color (hex format).
    icon : str | None
        Optional icon or emoji.
    is_default : bool
        Whether this is a default/system category.
    sort_order : int
        Display order for UI sorting.
    created_at : datetime
        Timestamp when the category was created.
    updated_at : datetime
        Timestamp when the category was last updated.

    """

    __tablename__ = "calendar_categories"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    name: str = Field(max_length=100, nullable=False)
    color: str = Field(max_length=50, nullable=False)
    icon: str | None = Field(default=None, max_length=50)
    is_default: bool = Field(default=False, nullable=False)
    sort_order: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of Category."""
        return (
            f"<Category(id={self.id}, name={self.name!r}, "
            f"color={self.color}, organization_id={self.organization_id})>"
        )
