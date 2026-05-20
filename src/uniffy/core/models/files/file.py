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
    """
    Status of text extraction for search indexing.

    Attributes
    ----------
    PENDING : str
        Queued for extraction (when background job system exists).
    PROCESSING : str
        Currently being processed.
    COMPLETED : str
        Text extracted and indexed in Meilisearch.
    FAILED : str
        Extraction failed (unsupported format, corrupt, etc.).
    SKIPPED : str
        Not applicable (binary files, images without OCR, etc.).

    """

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class TranscodeStatus(str, Enum):
    """Server-side transcode pipeline state.

    Drives the download-button gate. The user always sees a `.mp4`
    filename, regardless of whether the bytes on S3 are WebM (pending
    transcode) or MP4 (post-swap). Allowing the download while
    `PENDING`/`PROCESSING` would deliver mismatched bytes.

    Attributes
    ----------
    NOT_NEEDED : str
        Default. Non-video uploads, and recordings already encoded as
        H.264 MP4 by the browser (Safari).
    PENDING : str
        Enqueued by `complete_upload`; worker has not picked it up.
    PROCESSING : str
        Worker is holding the Valkey lock and running ffmpeg.
    COMPLETED : str
        Atomic swap done; `storage_key` points at the MP4.
    FAILED : str
        Worker errored; `storage_key` still points at the WebM. The
        download path serves the WebM rather than blocking the user.
    """

    NOT_NEEDED = "NOT_NEEDED"
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class File(SQLModel, table=True):
    """
    File model representing an uploaded file in the system.

    Files are organization-scoped and support versioning, folders,
    and the same permission model as notes.

    Attributes
    ----------
    id : UUID
        Unique identifier for the file (primary key).
    organization_id : UUID
        Organization this file belongs to (foreign key).
    owner_id : UUID
        User who owns the file (foreign key to login_users).
    access_mode : AccessMode
        How access to this file is governed (OWNER_ONLY, OPEN_TO_ORG, MEMBERS_ONLY).
    baseline_role : ContentRole | None
        Default role granted by the access mode.
    filename : str
        Current filename (may differ from original after rename).
    original_filename : str
        Original filename at upload time.
    mime_type : str
        MIME type of the file.
    size_bytes : int
        File size in bytes.
    storage_key : str
        S3 object key.
    storage_bucket : str
        S3 bucket name.
    folder_id : UUID | None
        Parent folder ID (nullable for root-level files).
    description : str | None
        Optional description for search.
    version : int
        Version number for optimistic locking.
    current_version_id : UUID | None
        Current version record ID (for version history).
    extraction_status : ExtractionStatus
        Status of text extraction for full-text search.
    is_deleted : bool
        Soft delete flag.
    deleted_at : datetime | None
        Timestamp when the file was soft-deleted.
    created_at : datetime
        Timestamp when the file was created.
    updated_at : datetime
        Timestamp when the file was last updated.

    """

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
        """Get the URN for this file."""
        return f"urn:uniffy:content:FILE:{self.id}"

    def __repr__(self) -> str:
        """Return string representation of File."""
        return (
            f"<File(id={self.id}, filename={self.filename!r}, "
            f"access_mode={self.access_mode}, organization_id={self.organization_id})>"
        )
