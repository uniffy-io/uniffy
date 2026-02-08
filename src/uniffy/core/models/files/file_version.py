"""FileVersion model for version history."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class FileVersion(SQLModel, table=True):
    """
    FileVersion model representing a historical version of a file.

    Each time a file is updated (re-uploaded), a new version record
    is created to preserve the history.

    Attributes
    ----------
    id : UUID
        Unique identifier for this version (primary key).
    file_id : UUID
        The file this version belongs to (foreign key).
    version_number : int
        Sequential version number (1, 2, 3, ...).
    size_bytes : int
        File size for this version.
    storage_key : str
        S3 object key for this version's content.
    storage_bucket : str
        S3 bucket name.
    checksum_sha256 : str | None
        SHA256 checksum of the file content.
    uploaded_by : UUID
        User who uploaded this version (foreign key).
    created_at : datetime
        Timestamp when this version was created.

    """

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
        """Return string representation of FileVersion."""
        return (
            f"<FileVersion(id={self.id}, file_id={self.file_id}, "
            f"version={self.version_number}, size={self.size_bytes})>"
        )
