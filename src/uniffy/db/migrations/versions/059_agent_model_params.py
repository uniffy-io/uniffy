"""Tunable model parameters: per-agent values + per-session overrides.

Revision ID: 059
Revises: 058
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "059"
down_revision: str | None = "058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_agents",
        sa.Column(
            "model_params",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "agents_sessions",
        sa.Column("model_params_override", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_sessions", "model_params_override")
    op.drop_column("agents_agents", "model_params")
