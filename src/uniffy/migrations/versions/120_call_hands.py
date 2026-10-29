"""Persist raised hands on active call participants."""

import sqlalchemy as sa
from alembic import op

revision: str = "120"
down_revision: str | None = "119"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "calls_participants", sa.Column("hand_raised_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "calls_participants",
        sa.Column("hand_revision", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("calls_participants", "hand_revision")
    op.drop_column("calls_participants", "hand_raised_at")
