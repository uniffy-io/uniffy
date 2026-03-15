"""Add extracted_text column to files_media_info.

Revision ID: 030
Revises: 029
Create Date: 2026-03-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "030"
down_revision: str = "029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add extracted_text column to files_media_info."""
    op.add_column(
        "files_media_info",
        sa.Column("extracted_text", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Remove extracted_text column from files_media_info."""
    op.drop_column("files_media_info", "extracted_text")
