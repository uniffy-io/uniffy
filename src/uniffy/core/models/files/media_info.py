"""Media info model for files."""

from typing import Any
from uuid import UUID

from sqlalchemy import Column, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class FileMediaInfo(SQLModel, table=True):
    """
    Extracted media information for a file.

    Attributes
    ----------
    file_id : UUID
        Primary key, foreign key to files_files.id (CASCADE delete).
    thumbnail_key : str | None
        S3 key for the generated thumbnail.
    thumbnail_width : int | None
        Thumbnail width in pixels.
    thumbnail_height : int | None
        Thumbnail height in pixels.
    width : int | None
        Original media width in pixels.
    height : int | None
        Original media height in pixels.
    format : str | None
        Image/media format (e.g. JPEG, PNG).
    color_mode : str | None
        Color mode (e.g. RGB, RGBA).
    duration_seconds : float | None
        Duration for video/audio files.
    page_count : int | None
        Page count for PDF files.
    bitrate : int | None
        Audio bitrate in bits per second.
    sample_rate : int | None
        Audio sample rate in Hz.
    channels : int | None
        Number of audio channels.
    exif : dict | None
        EXIF metadata as JSON.
    extraction_error : str | None
        Error message if extraction or thumbnail generation failed.

    """

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
    extraction_error: str | None = Field(default=None, max_length=2000)
