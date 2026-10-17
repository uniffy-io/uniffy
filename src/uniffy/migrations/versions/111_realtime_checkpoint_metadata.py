"""Add buffer epoch, serving Valkey identity and checkpoint sequence to realtime snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "111"
down_revision = "110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("realtime_yjs_snapshots", sa.Column("buffer_epoch", sa.Text(), nullable=True))
    op.add_column("realtime_yjs_snapshots", sa.Column("valkey_run_id", sa.Text(), nullable=True))
    op.add_column(
        "realtime_yjs_snapshots",
        sa.Column("checkpoint_seq", sa.BigInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    for column in ("checkpoint_seq", "valkey_run_id", "buffer_epoch"):
        op.drop_column("realtime_yjs_snapshots", column)
