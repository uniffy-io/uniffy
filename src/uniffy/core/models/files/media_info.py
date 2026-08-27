"""Media info model for files."""

from typing import Any
from uuid import UUID

from sqlalchemy import Column, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class FileMediaInfo(SQLModel, table=True):
    """Extracted media metadata and thumbnail reference for a file."""

    __tablename__ = "files_media_info"

    file_id: UUID = Field(
        sa_column=Column(
            "file_id",
            ForeignKey("files_files.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    thumbnail_key: str | None = Field(default=None, max_length=1000)
    thumbnail_width: int | None = Field(default=None)
    thumbnail_height: int | None = Field(default=None)
    width: int | None = Field(default=None)
    height: int | None = Field(default=None)
    format: str | None = Field(default=None, sa_column=Column("format", String(50)))
    color_mode: str | None = Field(default=None, max_length=50)
    duration_seconds: float | None = Field(default=None)
    page_count: int | None = Field(default=None)
    bitrate: int | None = Field(default=None)
    sample_rate: int | None = Field(default=None)
    channels: int | None = Field(default=None)
    exif: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    extracted_text: str | None = Field(default=None, sa_column=Column("extracted_text", Text))
    extraction_error: str | None = Field(default=None, max_length=2000)
    thumbnail_error: str | None = Field(default=None, max_length=2000)
