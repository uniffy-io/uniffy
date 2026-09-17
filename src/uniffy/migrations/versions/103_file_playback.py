"""Add versioned playback copies and durable abandoned-object cleanup."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "103"
down_revision = "102"
branch_labels = None
depends_on = None

_status = postgresql.ENUM(
    "NOT_NEEDED",
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    name="playbackstatus",
    create_type=False,
)


def upgrade() -> None:
    _status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "files_files",
        sa.Column("playback_status", _status, nullable=False, server_default="NOT_NEEDED"),
    )
    op.add_column("files_files", sa.Column("playback_key", sa.String(1000)))
    op.add_column("files_files", sa.Column("playback_version", sa.Integer()))
    op.add_column(
        "files_files",
        sa.Column("playback_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("files_files", sa.Column("playback_started_at", sa.DateTime(timezone=True)))
    op.add_column("files_files", sa.Column("playback_error", sa.String(2000)))
    op.create_index("ix_files_files_playback_status", "files_files", ["playback_status"])
    op.create_table(
        "files_renditions",
        sa.Column("storage_key", sa.String(1000), primary_key=True),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("upload_id", sa.String(1000)),
    )
    op.create_index("ix_files_renditions_file_id", "files_renditions", ["file_id"])
    op.create_index("ix_files_renditions_expires_at", "files_renditions", ["expires_at"])
    op.execute(
        "UPDATE files_files SET playback_status = 'PENDING' WHERE mime_type LIKE 'video/%' AND transcode_status = 'NOT_NEEDED'"
    )


def downgrade() -> None:
    op.drop_table("files_renditions")
    op.drop_index("ix_files_files_playback_status", table_name="files_files")
    for column in (
        "playback_status",
        "playback_key",
        "playback_version",
        "playback_attempts",
        "playback_started_at",
        "playback_error",
    ):
        op.drop_column("files_files", column)
    _status.drop(op.get_bind(), checkfirst=True)
