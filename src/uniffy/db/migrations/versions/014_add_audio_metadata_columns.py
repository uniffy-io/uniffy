"""Add audio metadata columns to files_media_info.

Adds bitrate, sample_rate, and channels columns for audio file
metadata extraction.

Revision ID: 014
Revises: 013
Create Date: 2026-02-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: str | None = "013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add audio metadata columns."""
    op.add_column("files_media_info", sa.Column("bitrate", sa.Integer(), nullable=True))
    op.add_column("files_media_info", sa.Column("sample_rate", sa.Integer(), nullable=True))
    op.add_column("files_media_info", sa.Column("channels", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove audio metadata columns."""
    op.drop_column("files_media_info", "channels")
    op.drop_column("files_media_info", "sample_rate")
    op.drop_column("files_media_info", "bitrate")
