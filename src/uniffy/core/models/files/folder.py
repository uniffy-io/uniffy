"""Folder model for the files feature."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import VisibilityScope
from uniffy.core.types import generate_id


class Folder(SQLModel, table=True):
    """
    Folder model representing a folder in the file hierarchy.

    Folders are organization-scoped and support nesting via parent_id.
    They follow the same permission model as files.

    Attributes
    ----------
    id : UUID
        Unique identifier for the folder (primary key).
    organization_id : UUID
        Organization this folder belongs to (foreign key).
    owner_id : UUID
        User who owns the folder (foreign key to login_users).
    visibility : VisibilityScope
        Who can access this folder (PRIVATE, GROUP, ORGANIZATION).
    name : str
        Folder name.
    parent_id : UUID | None
        Parent folder ID (nullable for root-level folders).
    is_system : bool
        System folder flag (e.g., Attachments folder). System folders cannot be deleted.
    is_deleted : bool
        Soft delete flag.
    deleted_at : datetime | None
        Timestamp when the folder was soft-deleted.
    created_at : datetime
        Timestamp when the folder was created.
    updated_at : datetime
        Timestamp when the folder was last updated.

    """

    __tablename__ = "files_folders"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    visibility: VisibilityScope = Field(
        default=VisibilityScope.PRIVATE,
        sa_column=Column(
            SAEnum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )
    name: str = Field(max_length=255, nullable=False)
    parent_id: UUID | None = Field(default=None, foreign_key="files_folders.id", index=True)
    is_system: bool = Field(default=False, nullable=False)
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

    @property
    def urn(self) -> str:
        """Get the URN for this folder (uses FILE type for simplicity)."""
        return f"urn:uniffy:content:FILE:{self.id}"

    def __repr__(self) -> str:
        """Return string representation of Folder."""
        return (
            f"<Folder(id={self.id}, name={self.name!r}, "
            f"visibility={self.visibility}, organization_id={self.organization_id})>"
        )
