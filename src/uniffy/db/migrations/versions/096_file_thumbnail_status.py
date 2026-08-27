"""Give thumbnail generation its own durable processing state.

Revision ID: 096
Revises: 095
Create Date: 2026-08-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "096"
down_revision: str | None = "095"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_thumbnail_status_enum = postgresql.ENUM(
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "SKIPPED",
    name="thumbnailstatus",
    create_type=False,
)

_THUMBNAIL_MIME_TYPES = (
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "application/pdf",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/mpeg",
    "video/ogg",
)
_IMAGE_EXTRACTION_MIME_TYPES = (
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
)
_AUDIO_EXTRACTION_MIME_TYPES = (
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/flac",
    "audio/x-flac",
    "audio/aac",
    "audio/ogg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/opus",
    "audio/webm",
)
_DOCUMENT_EXTRACTION_MIME_TYPES = (
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/html",
    "application/rtf",
    "text/rtf",
    "text/csv",
    "text/tab-separated-values",
    "text/plain",
    "text/markdown",
    "application/json",
    "application/xml",
)


def _sql_values(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    postgresql.ENUM(
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "SKIPPED",
        name="thumbnailstatus",
    ).create(op.get_bind(), checkfirst=True)

    op.add_column(
        "files_files",
        sa.Column(
            "thumbnail_status",
            _thumbnail_status_enum,
            nullable=False,
            server_default="SKIPPED",
        ),
    )
    op.add_column(
        "files_media_info",
        sa.Column("thumbnail_error", sa.String(length=2000), nullable=True),
    )

    supported_mime_types = _sql_values(_THUMBNAIL_MIME_TYPES)
    op.execute(
        f"""
        UPDATE files_files AS file
        SET thumbnail_status = CASE
            WHEN trim(split_part(file.mime_type, ';', 1)) NOT IN ({supported_mime_types})
                THEN 'SKIPPED'::thumbnailstatus
            WHEN EXISTS (
                SELECT 1
                FROM files_media_info AS media
                WHERE media.file_id = file.id AND media.thumbnail_key IS NOT NULL
            )
                THEN 'COMPLETED'::thumbnailstatus
            ELSE 'PENDING'::thumbnailstatus
        END
        WHERE trim(split_part(file.mime_type, ';', 1)) IN ({supported_mime_types})
        """
    )

    image_mime_types = _sql_values(_IMAGE_EXTRACTION_MIME_TYPES)
    audio_mime_types = _sql_values(_AUDIO_EXTRACTION_MIME_TYPES)
    document_mime_types = _sql_values(_DOCUMENT_EXTRACTION_MIME_TYPES)
    extraction_mime_types = _sql_values(
        _IMAGE_EXTRACTION_MIME_TYPES
        + _AUDIO_EXTRACTION_MIME_TYPES
        + _DOCUMENT_EXTRACTION_MIME_TYPES
    )
    processing_mime_types = _sql_values(
        _THUMBNAIL_MIME_TYPES
        + _IMAGE_EXTRACTION_MIME_TYPES
        + _AUDIO_EXTRACTION_MIME_TYPES
        + _DOCUMENT_EXTRACTION_MIME_TYPES
    )
    op.execute(
        f"""
        UPDATE files_files AS file
        SET extraction_status = CASE
            WHEN trim(split_part(file.mime_type, ';', 1)) NOT IN ({extraction_mime_types})
                THEN 'SKIPPED'::extractionstatus
            WHEN trim(split_part(file.mime_type, ';', 1)) IN ({image_mime_types})
                AND EXISTS (
                    SELECT 1
                    FROM files_media_info AS media
                    WHERE media.file_id = file.id
                        AND (
                            media.width IS NOT NULL
                            OR media.height IS NOT NULL
                            OR media.format IS NOT NULL
                            OR media.color_mode IS NOT NULL
                            OR media.exif IS NOT NULL
                        )
                )
                THEN 'COMPLETED'::extractionstatus
            WHEN trim(split_part(file.mime_type, ';', 1)) IN ({audio_mime_types})
                AND EXISTS (
                    SELECT 1
                    FROM files_media_info AS media
                    WHERE media.file_id = file.id
                        AND (
                            media.duration_seconds IS NOT NULL
                            OR media.bitrate IS NOT NULL
                            OR media.sample_rate IS NOT NULL
                            OR media.channels IS NOT NULL
                        )
                )
                THEN 'COMPLETED'::extractionstatus
            WHEN trim(split_part(file.mime_type, ';', 1)) IN ({document_mime_types})
                AND EXISTS (
                    SELECT 1
                    FROM files_media_info AS media
                    WHERE media.file_id = file.id AND media.extracted_text IS NOT NULL
                )
                THEN 'COMPLETED'::extractionstatus
            ELSE 'PENDING'::extractionstatus
        END
        WHERE trim(split_part(file.mime_type, ';', 1)) IN ({processing_mime_types})
        """
    )
    op.create_index(
        "ix_files_files_thumbnail_status",
        "files_files",
        ["thumbnail_status"],
        postgresql_where=sa.text("thumbnail_status IN ('PENDING', 'PROCESSING')"),
    )


def downgrade() -> None:
    op.drop_index("ix_files_files_thumbnail_status", table_name="files_files")
    op.drop_column("files_media_info", "thumbnail_error")
    op.drop_column("files_files", "thumbnail_status")
    postgresql.ENUM(name="thumbnailstatus").drop(op.get_bind(), checkfirst=True)
