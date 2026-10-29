"""Store sampled speaking activity without audio."""

import sqlalchemy as sa
from alembic import op

revision = "123"
down_revision = "122"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calls_activity",
        sa.Column(
            "participant_id",
            sa.Uuid(),
            sa.ForeignKey("calls_participants.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("offset_seconds", sa.Integer(), primary_key=True),
        sa.Column("observed_mask", sa.Integer(), nullable=False),
        sa.Column("speaking_mask", sa.Integer(), nullable=False),
        sa.CheckConstraint("offset_seconds >= 0 AND offset_seconds % 30 = 0"),
        sa.CheckConstraint("observed_mask BETWEEN 0 AND 1073741823"),
        sa.CheckConstraint("speaking_mask >= 0 AND (speaking_mask & observed_mask) = speaking_mask"),
    )


def downgrade() -> None:
    op.drop_table("calls_activity")
