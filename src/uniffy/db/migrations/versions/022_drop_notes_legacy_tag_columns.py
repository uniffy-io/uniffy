"""Drop legacy notes_notes.tags and notes_notes.inline_tags JSONB columns.

Revision ID: 022
Revises: 021
Create Date: 2026-05-07

Phase 2 of the unified-tags rollout cuts notes over to the central
``tags`` / ``tag_assignments`` store. The two JSONB columns become
dead weight after the cut-over; this migration drops them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "022"
down_revision: str | None = "021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("notes_notes", "tags")
    op.drop_column("notes_notes", "inline_tags")


def downgrade() -> None:
    op.add_column(
        "notes_notes",
        sa.Column(
            "inline_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "notes_notes",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
