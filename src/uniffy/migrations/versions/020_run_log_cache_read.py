"""Track prompt-cache reads on agent run logs.

Revision ID: 020
Revises: 019
Create Date: 2026-05-06

The Anthropic provider returns ``cache_read_input_tokens`` per turn --
the share of the prompt served from the prompt cache and billed at
~10% of the base input price. Migration 019 stored this on
``agents_messages`` and ``agents_channel_bindings`` for the per-turn
meter; this column lets the Usage dashboard aggregate cache reads
across runs (totals + time series) so cost savings are observable.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "020"
down_revision: str | None = "019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_run_logs",
        sa.Column(
            "cache_read_input_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("agents_run_logs", "cache_read_input_tokens")
