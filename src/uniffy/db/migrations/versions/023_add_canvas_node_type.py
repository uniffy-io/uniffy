"""Add CANVAS value to nodetype enum and canvas_content JSONB column

Revision ID: 023
Revises: 022
Create Date: 2026-02-15 00:00:00.000000

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add CANVAS to the nodetype enum and add canvas_content JSONB column."""
    op.execute("ALTER TYPE nodetype ADD VALUE IF NOT EXISTS 'CANVAS'")
    # Add canvas_content JSONB column (nullable)
    op.add_column("notes_notes", sa.Column("canvas_content", JSONB, nullable=True))


def downgrade() -> None:
    """Remove canvas_content column and move data back to content."""
    op.drop_column("notes_notes", "canvas_content")
