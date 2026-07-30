"""Image-generation defaults on the agent and per-conversation image overrides
on the channel binding.

Revision ID: 065
Revises: 064
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "065"
down_revision: str | None = "064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_agents",
        sa.Column(
            "image_params",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "agents_agents",
        sa.Column(
            "image_style_prompt",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )
    op.add_column(
        "agents_channel_bindings",
        sa.Column("image_params_override", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents_channel_bindings", "image_params_override")
    op.drop_column("agents_agents", "image_style_prompt")
    op.drop_column("agents_agents", "image_params")
