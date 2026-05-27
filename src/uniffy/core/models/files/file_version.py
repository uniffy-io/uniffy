"""FileVersion model for version history."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class FileVersion(SQLModel, table=True):
    """Historical version of a file; one row per re-upload."""

    __tablename__ = "files_file_versions"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    file_id: UUID = Field(foreign_key="files_files.id", nullable=False, index=True)
    version_number: int = Field(nullable=False)
    size_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    storage_key: str = Field(max_length=1000, nullable=False)
    storage_bucket: str = Field(max_length=255, nullable=False)
    checksum_sha256: str | None = Field(default=None, max_length=64)
    uploaded_by: UUID = Field(foreign_key="login_users.id", nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<FileVersion(id={self.id}, file_id={self.file_id}, "
            f"version={self.version_number}, size={self.size_bytes})>"
        )
