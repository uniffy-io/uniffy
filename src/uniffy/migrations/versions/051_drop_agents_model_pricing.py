"""Drop agents_model_pricing; pricing now lives in the in-tree model catalog.

Revision ID: 051
Revises: 050
Create Date: 2026-06-01

Model pricing moved out of the database (the ``agents_model_pricing`` table
and its ``PricingService`` admin RPCs) into the version-controlled model
catalog (``domains/agents/providers/catalog/catalog.json``). Run-log cost is
still computed at write time and frozen on ``agents_run_logs.cost``, so this
drop does not affect historical cost rows - only the now-unused price table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "051"
down_revision: str | None = "050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the model-pricing table and its lookup index."""
    op.drop_index(
        "ix_agents_model_pricing_lookup",
        table_name="agents_model_pricing",
    )
    op.drop_table("agents_model_pricing")


def downgrade() -> None:
    """Recreate the table structure (without seed rows)."""
    op.create_table(
        "agents_model_pricing",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column("input_per_1m", sa.Numeric(10, 4), nullable=True),
        sa.Column("output_per_1m", sa.Numeric(10, 4), nullable=True),
        sa.Column("cached_input_per_1m", sa.Numeric(10, 4), nullable=True),
        sa.Column("thinking_per_1m", sa.Numeric(10, 4), nullable=True),
        sa.Column("image_prices", sa.JSON(), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "model",
            "effective_from",
            name="uq_agents_model_pricing_provider_model_from",
        ),
    )
    op.create_index(
        "ix_agents_model_pricing_lookup",
        "agents_model_pricing",
        ["provider", "model", "effective_from"],
    )
