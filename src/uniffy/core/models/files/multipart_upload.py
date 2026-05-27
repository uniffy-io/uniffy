"""MultipartUpload model for tracking in-progress uploads."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import AccessMode, ContentRole, generate_id


class UploadStatus(str, Enum):
    """Lifecycle state of an in-progress multipart upload."""

    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"
    EXPIRED = "EXPIRED"


class MultipartUpload(SQLModel, table=True):
    """In-progress chunked upload. Drives resumability after network failures.

    Completed parts are tracked in `files_multipart_parts`; reads should go
    through ``FileOperations.list_completed_part_numbers``.
    """

    __tablename__ = "files_multipart_uploads"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
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

    def __repr__(self) -> str:
        return (
            f"<MultipartUpload(id={self.id}, filename={self.filename!r}, "
            f"status={self.status}, total_chunks={self.total_chunks})>"
        )
