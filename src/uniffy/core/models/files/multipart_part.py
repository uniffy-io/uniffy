"""MultipartPart: one row per uploaded chunk of a multipart upload.

The `UNIQUE(upload_id, part_number)` constraint lets concurrent backend
instances upsert parts atomically (`ON CONFLICT DO UPDATE`) so chunks
aren't lost under fan-out writes.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class MultipartPart(SQLModel, table=True):
    """One uploaded chunk of a multipart upload."""

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
        return f"<MultipartPart(upload_id={self.upload_id}, part_number={self.part_number})>"
