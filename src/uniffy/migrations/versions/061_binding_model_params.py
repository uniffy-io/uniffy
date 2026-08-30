"""Per-(channel, agent) model parameter overrides on the binding row.

Revision ID: 061
Revises: 060
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "061"
down_revision: str | None = "060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_channel_bindings",
        sa.Column("model_params_override", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_channel_bindings", "model_params_override")
