"""Add inline_tags column to notes

Revision ID: 009
Revises: 008
Create Date: 2026-01-28 10:00:00.000000

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add inline_tags JSONB column to notes_notes table."""
    op.add_column(
        "notes_notes",
        sa.Column("inline_tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    """Remove inline_tags column from notes_notes table."""
    op.drop_column("notes_notes", "inline_tags")
