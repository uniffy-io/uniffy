"""File model for the files feature."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, Relationship, SQLModel

from uniffy.core.models.files.media_info import FileMediaInfo  # noqa: F401
from uniffy.core.types import AccessMode, ContentRole, generate_id


class ExtractionStatus(str, Enum):
    """Text-extraction pipeline state for full-text search indexing."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class TranscodeStatus(str, Enum):
    """Server-side transcode state.

    Gates the download button: the user always sees a `.mp4` filename, but
    storage may still hold WebM until the swap. Allowing download while
    PENDING/PROCESSING would deliver mismatched bytes. On FAILED we serve
    the original WebM rather than block the user.
    """

    NOT_NEEDED = "NOT_NEEDED"
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class File(SQLModel, table=True):
    """Uploaded file row. Org-scoped, supports versioning and folder placement."""

    __tablename__ = "files_files"

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
    filename: str = Field(max_length=500, nullable=False)
    original_filename: str = Field(max_length=500, nullable=False)
    mime_type: str = Field(max_length=255, nullable=False)
    size_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    storage_key: str = Field(max_length=1000, nullable=False)
    storage_bucket: str = Field(max_length=255, nullable=False)
    folder_id: UUID | None = Field(default=None, foreign_key="files_folders.id", index=True)
    description: str | None = Field(default=None, max_length=2000)
    version: int = Field(default=1, nullable=False)
    current_version_id: UUID | None = Field(
        default=None, foreign_key="files_file_versions.id", nullable=True
    )
    extraction_status: ExtractionStatus = Field(
        default=ExtractionStatus.PENDING,
        sa_column=Column(
            SAEnum(
                ExtractionStatus,
                name="extractionstatus",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
            server_default="PENDING",
        ),
    )
    transcode_status: TranscodeStatus = Field(
        default=TranscodeStatus.NOT_NEEDED,
        sa_column=Column(
            SAEnum(
                TranscodeStatus,
                name="transcodestatus",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            server_default="NOT_NEEDED",
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

    media_info: FileMediaInfo | None = Relationship(
        sa_relationship_kwargs={
            "uselist": False,
            "lazy": "noload",
            "cascade": "all, delete-orphan",
        },
    )

    @property
    def urn(self) -> str:
        return f"urn:uniffy:content:FILE:{self.id}"

    def __repr__(self) -> str:
        return (
            f"<File(id={self.id}, filename={self.filename!r}, "
            f"access_mode={self.access_mode}, organization_id={self.organization_id})>"
        )
