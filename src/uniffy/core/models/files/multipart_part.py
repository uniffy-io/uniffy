"""MultipartPart model: one row per uploaded chunk of a multipart upload.

Replaces the old `MultipartUpload.parts_completed` JSONB column. The JSONB
read-modify-write pattern lost chunks under concurrent appends across the
15-20 backend instances. A separate table with `UNIQUE(upload_id, part_number)`
makes part inserts atomic and idempotent: instances issue
`INSERT ... ON CONFLICT (upload_id, part_number) DO UPDATE SET etag = ..., size = ...`
and the database serialises concurrent writes for free.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class MultipartPart(SQLModel, table=True):
    """One uploaded chunk of a multipart upload.

    Attributes
    ----------
    id : UUID
        Internal unique identifier.
    upload_id : UUID
        FK to :class:`MultipartUpload`.
    part_number : int
        S3 part number (1-indexed).
    etag : str
        ETag returned by S3 when the part was uploaded.
    size : int
        Size of the part in bytes.
    created_at : datetime
        When the part was recorded.

    """

    __tablename__ = "files_multipart_parts"
    __table_args__ = (
        UniqueConstraint("upload_id", "part_number", name="uq_multipart_parts_upload_part"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    upload_id: UUID = Field(
        foreign_key="files_multipart_uploads.id",
        nullable=False,
        index=True,
    )
    part_number: int = Field(nullable=False)
    etag: str = Field(max_length=255, nullable=False)
    size: int = Field(sa_column=Column(BigInteger, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<MultipartPart(upload_id={self.upload_id}, part_number={self.part_number})>"
