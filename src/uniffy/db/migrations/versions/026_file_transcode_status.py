"""Add transcode_status to files_files.

Revision ID: 026
Revises: 025
Create Date: 2026-05-09

The screen recording feature ships a `.mp4` filename to the user from
the moment they click Stop, even though Brave / Chrome / Firefox
produce VP9/Opus WebM via `MediaRecorder`. A worker transcodes the
WebM bytes to H.264/AAC MP4 in the background and atomically swaps
the live `storage_key`. The download path gates on this column so
the user never receives an unplayable container labelled `.mp4`.

Values:
- NOT_NEEDED: non-recording uploads, Safari path (already MP4).
- PENDING: just enqueued by complete_upload.
- PROCESSING: worker holds the lock.
- COMPLETED: swap done, MP4 is the live key.
- FAILED: worker crashed; download falls back to serving the WebM.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "026"
down_revision: str | None = "025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_transcode_status_enum = postgresql.ENUM(
    "NOT_NEEDED",
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    name="transcodestatus",
    create_type=False,
)


def upgrade() -> None:
    """Create the transcodestatus enum and column."""
    postgresql.ENUM(
        "NOT_NEEDED",
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        name="transcodestatus",
    ).create(op.get_bind(), checkfirst=True)

    op.add_column(
        "files_files",
        sa.Column(
            "transcode_status",
            _transcode_status_enum,
            nullable=False,
            server_default="NOT_NEEDED",
        ),
    )
    op.create_index(
        "ix_files_files_transcode_status",
        "files_files",
        ["transcode_status"],
        postgresql_where=sa.text("transcode_status IN ('PENDING', 'PROCESSING')"),
    )


def downgrade() -> None:
    """Drop the transcodestatus column and enum."""
    op.drop_index(
        "ix_files_files_transcode_status",
        table_name="files_files",
    )
    op.drop_column("files_files", "transcode_status")
    postgresql.ENUM(name="transcodestatus").drop(op.get_bind(), checkfirst=True)
