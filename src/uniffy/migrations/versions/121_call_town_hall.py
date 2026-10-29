"""Persist call publishing policy and speaker grants."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "121"
down_revision: str | None = "120"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "calls_calls",
        sa.Column("town_hall", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "calls_calls",
        sa.Column("speaker_user_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "calls_calls",
        sa.Column("publishing_revision", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("calls_calls", "publishing_revision")
    op.drop_column("calls_calls", "speaker_user_ids")
    op.drop_column("calls_calls", "town_hall")
