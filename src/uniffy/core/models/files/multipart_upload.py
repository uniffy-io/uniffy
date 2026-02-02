"""MultipartUpload model for tracking in-progress uploads."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Column, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import VisibilityScope


class UploadStatus(str, Enum):
    """
    Status of a multipart upload.

    Attributes
    ----------
    ACTIVE : str
        Upload is in progress.
    COMPLETED : str
        Upload completed successfully.
    ABORTED : str
        Upload was aborted by user or system.
    EXPIRED : str
        Upload expired due to inactivity.

    """

    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"
    EXPIRED = "EXPIRED"


class MultipartUpload(SQLModel, table=True):
    """
    MultipartUpload model for tracking in-progress file uploads.

    This table tracks multipart uploads to enable resumable uploads.
    When a client reconnects after a network failure, they can query
    this table to find which chunks have been completed.

    Attributes
    ----------
    id : UUID
        Internal unique identifier (primary key).
    organization_id : UUID
        Organization this upload belongs to.
    user_id : UUID
        User performing the upload.
    s3_upload_id : str
        The S3 multipart upload ID.
    storage_key : str
        S3 object key where file will be stored.
    storage_bucket : str
        S3 bucket name.
    filename : str
        Target filename.
    mime_type : str
        MIME type of the file.
    total_size : int
        Expected total file size in bytes.
    total_chunks : int
        Expected total number of chunks.
    chunk_size : int
        Size of each chunk in bytes.
    folder_id : UUID | None
        Target folder ID (nullable for root).
    visibility : VisibilityScope
        Target visibility for the file.
    status : UploadStatus
        Current status of the upload.
    parts_completed : list[dict] | None
        List of completed parts: [{"part_number": int, "etag": str, "size": int}].
    expires_at : datetime
        When this upload expires if not completed.
    created_at : datetime
        When the upload was initiated.
    updated_at : datetime
        When the upload was last updated.

    """

    __tablename__ = "files_multipart_uploads"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    s3_upload_id: str = Field(max_length=500, nullable=False)
    storage_key: str = Field(max_length=1000, nullable=False)
    storage_bucket: str = Field(max_length=255, nullable=False)
    filename: str = Field(max_length=500, nullable=False)
    mime_type: str = Field(max_length=255, nullable=False)
    total_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    total_chunks: int = Field(nullable=False)
    chunk_size: int = Field(nullable=False)
    folder_id: UUID | None = Field(default=None, foreign_key="files_folders.id", nullable=True)
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
        ),
    )
    status: UploadStatus = Field(
        default=UploadStatus.ACTIVE,
        sa_column=Column(
            SAEnum(
                UploadStatus,
                name="uploadstatus",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
            server_default="ACTIVE",
        ),
    )
    parts_completed: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSONB))
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def get_completed_chunk_numbers(self) -> list[int]:
        """Get list of completed chunk numbers."""
        if not self.parts_completed:
            return []
        return sorted([p["part_number"] for p in self.parts_completed])

    def __repr__(self) -> str:
        """Return string representation of MultipartUpload."""
        return (
            f"<MultipartUpload(id={self.id}, filename={self.filename!r}, "
            f"status={self.status}, chunks={len(self.parts_completed or [])}/{self.total_chunks})>"
        )
