"""Drop legacy files_files.tags JSONB column.

Revision ID: 023
Revises: 022
Create Date: 2026-05-07

Phase 3 of the unified-tags rollout cuts files over to the central
``tags`` / ``tag_assignments`` store. The JSONB column becomes dead
weight after the cut-over; this migration drops it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "023"
down_revision: str | None = "022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("files_files", "tags")


def downgrade() -> None:
    op.add_column(
        "files_files",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
