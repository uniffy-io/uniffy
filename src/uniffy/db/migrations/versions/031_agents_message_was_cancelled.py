"""Add ``was_cancelled`` to agents_messages.

Revision ID: 031
Revises: 030
Create Date: 2026-05-19

A cancelled assistant turn writes a real row (so the placeholder
persists across refreshes) with ``was_cancelled = true`` set. The UI
renders it as the "Agent response cancelled" bubble.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "031"
down_revision: str | None = "030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the was_cancelled flag column."""
    op.add_column(
        "agents_messages",
        sa.Column(
            "was_cancelled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    """Drop the was_cancelled column."""
    op.drop_column("agents_messages", "was_cancelled")
