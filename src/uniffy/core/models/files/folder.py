"""Folder model for the files feature."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class Folder(SQLModel, table=True):
    """Folder in the org file hierarchy; nests via parent_id, shares the file permission model."""

    __tablename__ = "files_folders"
    # Serves the per-folder subfolder COUNT behind folder mention stats.
    __table_args__ = (Index("ix_files_folders_parent_id_is_deleted", "parent_id", "is_deleted"),)

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            SAEnum(
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
            SAEnum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
        ),
    )
    name: str = Field(max_length=255, nullable=False)
    parent_id: UUID | None = Field(default=None, foreign_key="files_folders.id", index=True)
    is_system: bool = Field(default=False, nullable=False)
    is_org_attachments: bool = Field(default=False, nullable=False)
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
        return f"urn:uniffy:content:FOLDER:{self.id}"

    def __repr__(self) -> str:
        return (
            f"<Folder(id={self.id}, name={self.name!r}, "
            f"access_mode={self.access_mode}, organization_id={self.organization_id})>"
        )
