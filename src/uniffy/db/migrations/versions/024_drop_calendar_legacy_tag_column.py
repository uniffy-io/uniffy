"""Drop legacy calendar_events.tags JSONB column.

Revision ID: 024
Revises: 023
Create Date: 2026-05-07

Phase 4 of the unified-tags rollout cuts calendar events over to the
central ``tags`` / ``tag_assignments`` store. The JSONB column becomes
dead weight after the cut-over; this migration drops it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "024"
down_revision: str | None = "023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("calendar_events", "tags")


def downgrade() -> None:
    op.add_column(
        "calendar_events",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
