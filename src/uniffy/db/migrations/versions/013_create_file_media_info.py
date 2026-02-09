"""Create files_media_info table.

Splits file_metadata JSONB into a dedicated table so concurrent worker
tasks (thumbnail generation + metadata extraction) can UPSERT their own
columns without overwriting each other.

Revision ID: 013
Revises: 012
Create Date: 2026-02-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "013"
down_revision: str | None = "012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create files_media_info table and copy existing data."""
    op.create_table(
        "files_media_info",
        sa.Column(
            "file_id",
            sa.Uuid(),
            sa.ForeignKey("files_files.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("thumbnail_key", sa.String(1000), nullable=True),
        sa.Column("thumbnail_width", sa.Integer(), nullable=True),
        sa.Column("thumbnail_height", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(50), nullable=True),
        sa.Column("color_mode", sa.String(50), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("exif", postgresql.JSONB(), nullable=True),
        sa.Column("extraction_error", sa.String(2000), nullable=True),
    )

    # Copy existing data from file_metadata JSONB into the new table
    op.execute(
        sa.text("""
            INSERT INTO files_media_info (
                file_id,
                thumbnail_key,
                thumbnail_width,
                thumbnail_height,
                width,
                height,
                format,
                color_mode,
                duration_seconds,
                page_count,
                exif,
                extraction_error
            )
            SELECT
                id,
                file_metadata->>'thumbnail_key',
                (file_metadata->>'thumbnail_width')::integer,
                (file_metadata->>'thumbnail_height')::integer,
                (file_metadata->>'width')::integer,
                (file_metadata->>'height')::integer,
                file_metadata->>'format',
                file_metadata->>'mode',
                (file_metadata->>'duration_seconds')::double precision,
                (file_metadata->>'page_count')::integer,
                file_metadata->'exif',
                file_metadata->>'extraction_error'
            FROM files_files
            WHERE file_metadata IS NOT NULL
        """)
    )

    # Drop the old JSONB column now that data lives in files_media_info
    op.drop_column("files_files", "file_metadata")


def downgrade() -> None:
    """Restore file_metadata column and drop files_media_info table."""
    # Re-add the JSONB column
    op.add_column(
        "files_files",
        sa.Column("file_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # Copy data back from files_media_info into the JSONB column
    op.execute(
        sa.text("""
            UPDATE files_files f
            SET file_metadata = jsonb_strip_nulls(jsonb_build_object(
                'thumbnail_key', mi.thumbnail_key,
                'thumbnail_width', mi.thumbnail_width,
                'thumbnail_height', mi.thumbnail_height,
                'width', mi.width,
                'height', mi.height,
                'format', mi.format,
                'mode', mi.color_mode,
                'duration_seconds', mi.duration_seconds,
                'page_count', mi.page_count,
                'exif', mi.exif,
                'extraction_error', mi.extraction_error
            ))
            FROM files_media_info mi
            WHERE mi.file_id = f.id
        """)
    )

    op.drop_table("files_media_info")
