"""Persisted reasoning display blocks on agent session messages.

Revision ID: 060
Revises: 059
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "060"
down_revision: str | None = "059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_messages",
        sa.Column("thinking", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_messages", "thinking")
