"""Persist cache creation and per-call model usage for agent runs.

Revision ID: 078
Revises: 077
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "078"
down_revision: str | None = "077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_messages",
        sa.Column(
            "cache_creation_input_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "cache_creation_input_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agents_run_logs",
        sa.Column("model_calls", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_run_logs", "model_calls")
    op.drop_column("agents_run_logs", "cache_creation_input_tokens")
    op.drop_column("agents_messages", "cache_creation_input_tokens")
