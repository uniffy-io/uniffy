"""Add file_ids JSONB column to agents_messages.

Revision ID: 031
Revises: 030
Create Date: 2026-03-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "031"
down_revision: str = "030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add file_ids column to agents_messages."""
    op.add_column(
        "agents_messages",
        sa.Column("file_ids", JSONB, nullable=True),
    )


def downgrade() -> None:
    """Remove file_ids column from agents_messages."""
    op.drop_column("agents_messages", "file_ids")
