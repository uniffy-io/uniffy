"""Throttle redispatch and tune vacuum for chat delivery tables."""

import sqlalchemy as sa
from alembic import op

revision = "129"
down_revision = "128"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_deliveries", sa.Column("dispatched_at", sa.DateTime(timezone=True)))
    # Bound dead tuples even while an outage makes the live backlog large.
    op.execute(
        "ALTER TABLE chat_deliveries SET (autovacuum_vacuum_threshold = 1000, autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_max_threshold = 10000, autovacuum_analyze_threshold = 500, autovacuum_analyze_scale_factor = 0.02)"
    )
    op.execute(
        "ALTER TABLE agents_chat_triggers SET (autovacuum_vacuum_threshold = 1000, autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_max_threshold = 20000, autovacuum_analyze_threshold = 500, autovacuum_analyze_scale_factor = 0.02)"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE chat_deliveries RESET (autovacuum_vacuum_threshold, autovacuum_vacuum_scale_factor, autovacuum_vacuum_max_threshold, autovacuum_analyze_threshold, autovacuum_analyze_scale_factor)"
    )
    op.execute(
        "ALTER TABLE agents_chat_triggers RESET (autovacuum_vacuum_threshold, autovacuum_vacuum_scale_factor, autovacuum_vacuum_max_threshold, autovacuum_analyze_threshold, autovacuum_analyze_scale_factor)"
    )
    op.drop_column("chat_deliveries", "dispatched_at")
