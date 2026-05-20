"""Drop the ``notes_notes.realtime_enabled`` column if present.

Revision ID: 033
Revises: 032
Create Date: 2026-05-19

The column is no longer read by the runtime.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "033"
down_revision: str | None = "032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE notes_notes DROP COLUMN IF EXISTS realtime_enabled")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE notes_notes "
        "ADD COLUMN IF NOT EXISTS realtime_enabled BOOLEAN NOT NULL DEFAULT FALSE"
    )
